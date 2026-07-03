import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-keys';
import { db, policies, executions, users, usageRecords } from '@/lib/prisma';
import { eq, sql, desc, asc } from 'drizzle-orm';
import { PLANS, PlanType } from '@/lib/plans';
import { upgradeResponse } from '@/lib/plan-quota';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';
import { executePolicyUnified, getPrimaryError, deriveExecutionDecision } from '@/services/policy/cnl-executor';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// 获取当前周期字符串（YYYY-MM）
function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 单个 SQL 查询结果类型
type UnifiedQueryResult = {
  // Policy fields
  policy_id: string | null;
  policy_name: string | null;
  policy_content: string | null;
  policy_user_id: string | null;
  policy_team_id: string | null;
  policy_is_public: boolean | null;
  // 活跃版本冻结的关键词别名（canonical JSON）。C1（v1）：执行时透传别名。
  policy_alias_set: string | null;
  // User fields
  user_plan: string | null;
  user_trial_ends_at: Date | null;
  // Usage counts
  api_usage_count: number | null;
  exec_usage_count: number | null;
  // Team membership
  is_team_member: boolean;
  [key: string]: unknown;
}

export async function POST(req: Request, { params }: RouteParams) {
  const startTime = Date.now();

  try {
    // 阶段1：并行获取初始数据
    const [auth, { id }, bodyResult] = await Promise.all([
      authenticateApiRequest(req),
      params,
      req.json().catch(() => null),
    ]);

    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId, apiKeyId } = auth;

    if (bodyResult === null || typeof bodyResult !== 'object' || Array.isArray(bodyResult)) {
      return NextResponse.json({ error: 'Request body must be a valid object' }, { status: 400 });
    }

    const { input } = bodyResult as { input?: unknown };
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ error: 'Input must be a valid object' }, { status: 400 });
    }

    const validatedInput = input as Record<string, unknown>;
    const period = getCurrentPeriod();

    // 阶段2：单个统一 SQL 查询获取所有数据
    const result = await db.execute<UnifiedQueryResult>(sql`
      SELECT
        p.id AS policy_id,
        p.name AS policy_name,
        p.content AS policy_content,
        p."userId" AS policy_user_id,
        p."teamId" AS policy_team_id,
        p."isPublic" AS policy_is_public,
        pv."aliasSet" AS policy_alias_set,
        u.plan AS user_plan,
        u."trialEndsAt" AS user_trial_ends_at,
        api_ur.count AS api_usage_count,
        exec_ur.count AS exec_usage_count,
        CASE WHEN tm.id IS NOT NULL THEN true ELSE false END AS is_team_member
      FROM "Policy" p
      -- 活跃版本的冻结 aliasSet（版本号 = Policy.version；与 content 同源）。C1（v1）。
      LEFT JOIN "PolicyVersion" pv ON pv."policyId" = p.id AND pv.version = p.version
      CROSS JOIN "User" u
      LEFT JOIN "UsageRecord" api_ur ON api_ur."userId" = ${userId}
        AND api_ur.type = 'api_call'
        AND api_ur.period = ${period}
      LEFT JOIN "UsageRecord" exec_ur ON exec_ur."userId" = ${userId}
        AND exec_ur.type = 'execution'
        AND exec_ur.period = ${period}
      LEFT JOIN "TeamMember" tm ON tm."userId" = ${userId}
        AND tm."teamId" = p."teamId"
      WHERE p.id = ${id}
        AND p."deletedAt" IS NULL
        AND u.id = ${userId}
      LIMIT 1
    `);

    // postgres-js returns an array directly
    const rows = result as unknown as UnifiedQueryResult[];
    const row = rows[0];

    // 解构查询结果
    const policy = row?.policy_id ? {
      id: row.policy_id,
      name: row.policy_name!,
      content: row.policy_content!,
      userId: row.policy_user_id!,
      teamId: row.policy_team_id,
      isPublic: row.policy_is_public ?? false,
      aliasSet: row.policy_alias_set ?? null,
    } : null;

    const userData = row ? {
      plan: row.user_plan,
      trialEndsAt: row.user_trial_ends_at,
    } : null;

    const apiCallUsage = row?.api_usage_count ?? 0;
    const executionUsage = row?.exec_usage_count ?? 0;
    const isTeamMember = row?.is_team_member ?? false;

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 权限检查（快速路径：所有者或公开策略）
    const isOwner = policy.userId === userId;
    const isPublic = policy.isPublic;

    // 权限验证（团队成员资格已在 SQL 查询中获取）
    if (!isOwner && !isPublic && !isTeamMember) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 团队成员权限检查（仅非所有者）
    if (!isOwner && policy.teamId) {
      const permCheck = await checkTeamPermission(userId, policy.teamId, TeamPermission.POLICY_EXECUTE);
      if (!permCheck.allowed) {
        return NextResponse.json({ error: permCheck.error }, { status: permCheck.status });
      }
    }

    // 策略冻结检查：冻结取决于「策略所有者」的套餐限制，与调用者是否为所有者无关。
    // 所有者套餐降级后超限的策略同样被冻结——所有者执行自己的冻结策略也必须拦截。
    // 旧实现把此检查放在 if(!isOwner) 内，导致所有者可执行自己的冻结策略（越权点）。
    // 冻结是「策略状态」级拦截，须先于用量配额检查——避免对一个根本不可运行的
    // 冻结策略报「配额超限(429)」误导用户，正确语义是「策略已冻结(403)」。
    const ownerData = await db.query.users.findFirst({
      where: eq(users.id, policy.userId),
      columns: { plan: true, trialEndsAt: true },
    });
    if (ownerData) {
      const ownerPlan: PlanType = (ownerData.plan && ownerData.plan in PLANS ? ownerData.plan : 'free') as PlanType;
      const ownerTrialExpired = ownerPlan === 'trial' && ownerData.trialEndsAt && ownerData.trialEndsAt < new Date();
      const ownerEffectivePlan: PlanType = ownerTrialExpired ? 'free' : ownerPlan;
      const ownerPolicyLimit = PLANS[ownerEffectivePlan].limits.policies;

      if (ownerPolicyLimit !== -1) {
        const activePolicies = await db.query.policies.findMany({
          where: eq(policies.userId, policy.userId),
          orderBy: [desc(policies.updatedAt), asc(policies.id)],
          limit: ownerPolicyLimit,
          columns: { id: true },
        });
        if (!activePolicies.some(p => p.id === id)) {
          return NextResponse.json(
            { error: 'Policy is frozen', message: `This policy is frozen because the owner's plan limit has been exceeded.`, frozen: true },
            { status: 403 }
          );
        }
      }
    }

    // 配额检查（调用者自身用量）
    const rawPlan = userData?.plan;
    const plan: PlanType = (rawPlan && rawPlan in PLANS ? rawPlan : 'free') as PlanType;
    const trialExpired = plan === 'trial' && userData?.trialEndsAt && userData.trialEndsAt < new Date();
    const effectivePlan: PlanType = trialExpired ? 'free' : plan;
    const limits = PLANS[effectivePlan].limits;

    if (limits.apiCalls !== -1 && apiCallUsage >= limits.apiCalls) {
      return NextResponse.json(
        upgradeResponse('evaluations', {
          usage: apiCallUsage,
          limit: limits.apiCalls,
          message: `You've reached your monthly limit of ${limits.apiCalls} API calls.`,
        }),
        { status: 429 }
      );
    }

    if (limits.executions !== -1 && executionUsage >= limits.executions) {
      return NextResponse.json(
        upgradeResponse('evaluations', {
          usage: executionUsage,
          limit: limits.executions,
          message: `You've reached your monthly limit of ${limits.executions} executions.`,
        }),
        { status: 429 }
      );
    }

    // 阶段3+4：所有门（权限/冻结/配额）通过后才真正执行策略。
    // 旧实现「乐观执行」在门检查之前就调后端 evaluateSource，导致即使返回
    // 403/429，策略已在后端执行一次——冻结策略必须零执行。
    // C1（v1）：解析活跃版本冻结的 aliasSet（canonical JSON）透传给执行端，使别名源码能编译。
    // 冻结即信任——执行时以 allowStructural=true 应用（授权在创建时已定），不重查 grant。
    // 损坏的 aliasSet 视为无别名，不阻塞执行（envelope 另有防篡改）。
    let parsedAliasSet: Record<string, string[]> | null = null;
    if (policy.aliasSet) {
      try {
        parsedAliasSet = JSON.parse(policy.aliasSet) as Record<string, string[]>;
      } catch {
        parsedAliasSet = null;
      }
    }

    const executionResult = await executePolicyUnified({
      // 部分 Policy 投影（执行端只读 .content）；新增的 aliasSet:string|null 与完整 Policy
      // 行的字段类型不再充分重叠，按 TS 提示经 unknown 桥接（沿用本路径既有部分投影模式）。
      policy: policy as unknown as Parameters<typeof executePolicyUnified>[0]['policy'],
      input: validatedInput,
      userId,
      tenantId: policy.teamId || policy.userId,
      aliasSet: parsedAliasSet,
    });
    const primaryError = getPrimaryError(executionResult);
    const durationMs = Date.now() - startTime;

    // 异步写入（fire-and-forget）
    const now = new Date();
    const writePromise = Promise.all([
      db.insert(executions).values({
        id: globalThis.crypto.randomUUID(),
        userId,
        policyId: id,
        input: validatedInput as object,
        output: executionResult as object,
        error: primaryError,
        durationMs,
        // success 保持 = allowed（旧语义不变）；准入四态由新增 decision 列表达（服务端派生）。
        success: executionResult.allowed ?? false,
        decision: deriveExecutionDecision(executionResult),
        source: 'api',
        apiKeyId: apiKeyId || null,
      }),
      db.insert(usageRecords)
        .values({ id: crypto.randomUUID(), userId, type: 'api_call', period, count: 1, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [usageRecords.userId, usageRecords.type, usageRecords.period],
          set: { count: sql`${usageRecords.count} + 1`, updatedAt: now },
        }),
      db.insert(usageRecords)
        .values({ id: crypto.randomUUID(), userId, type: 'execution', period, count: 1, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [usageRecords.userId, usageRecords.type, usageRecords.period],
          set: { count: sql`${usageRecords.count} + 1`, updatedAt: now },
        }),
    ]).catch(err => console.error('Failed to record execution:', err));

    // 使用 OpenNext 的 getCloudflareContext 获取 ctx.waitUntil
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil(writePromise);
    } catch {
      // 非 Cloudflare 环境，直接执行（不阻塞响应）
      void writePromise;
    }

    return NextResponse.json({
      success: executionResult.allowed,
      data: executionResult,
      error: primaryError,
      meta: {
        policyId: id,
        policyName: policy.name,
        durationMs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('API execution error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

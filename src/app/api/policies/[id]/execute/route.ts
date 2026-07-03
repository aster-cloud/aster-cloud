import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies, executions, users, usageRecords } from '@/lib/prisma';
import { eq, sql, desc, asc } from 'drizzle-orm';
import { PLANS, PlanType } from '@/lib/plans';
import { upgradeResponse } from '@/lib/plan-quota';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';
import { executePolicyUnified, getPrimaryError } from '@/services/policy/cnl-executor';
import { getCachedPolicyMeta, cachePolicyMeta, type CachedPolicyMeta } from '@/lib/cache';

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
  policy_alias_set: string | null;
  policy_user_id: string | null;
  policy_team_id: string | null;
  policy_is_public: boolean | null;
  // User fields
  user_plan: string | null;
  user_trial_ends_at: Date | null;
  // Usage count
  usage_count: number | null;
  // Team membership (for non-owner access)
  is_team_member: boolean;
  [key: string]: unknown;
}

export async function POST(req: Request, { params }: RouteParams) {
  const startTime = Date.now();
  const timings: Record<string, number> = {};

  try {
    // 阶段1：并行获取初始数据
    const t1 = Date.now();
    const [session, { id }, bodyResult] = await Promise.all([
      getSession(),
      params,
      req.json().catch(() => null),
    ]);
    timings.auth = Date.now() - t1;

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (bodyResult === null || typeof bodyResult !== 'object' || Array.isArray(bodyResult)) {
      return NextResponse.json({ error: 'Request body must be a valid object' }, { status: 400 });
    }

    const { input, functionName } = bodyResult as { input?: unknown; functionName?: unknown };
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ error: 'Input must be a valid object' }, { status: 400 });
    }
    if (functionName !== undefined && typeof functionName !== 'string') {
      return NextResponse.json({ error: 'functionName must be a string' }, { status: 400 });
    }

    const validatedInput = input as Record<string, unknown>;
    const userId = session.user.id;
    const period = getCurrentPeriod();

    // 阶段2：尝试从 KV 缓存获取策略元数据
    const t2 = Date.now();
    let policy: CachedPolicyMeta | null = null;
    let cacheHit = false;

    const cachedPolicy = await getCachedPolicyMeta(id);
    if (cachedPolicy) {
      policy = cachedPolicy;
      cacheHit = true;
      timings.cacheHit = Date.now() - t2;
    }

    // 获取用户数据、使用量和团队成员状态
    const tDb = Date.now();
    const result = await db.execute<UnifiedQueryResult>(cacheHit ? sql`
      SELECT
        NULL::text AS policy_id,
        NULL::text AS policy_name,
        NULL::text AS policy_content,
        NULL::text AS policy_alias_set,
        NULL::text AS policy_user_id,
        NULL::text AS policy_team_id,
        NULL::boolean AS policy_is_public,
        u.plan AS user_plan,
        u."trialEndsAt" AS user_trial_ends_at,
        ur.count AS usage_count,
        CASE WHEN tm.id IS NOT NULL THEN true ELSE false END AS is_team_member
      FROM "User" u
      LEFT JOIN "UsageRecord" ur ON ur."userId" = ${userId}
        AND ur.type = 'execution'
        AND ur.period = ${period}
      LEFT JOIN "TeamMember" tm ON tm."userId" = ${userId}
        AND tm."teamId" = ${policy!.teamId}
      WHERE u.id = ${userId}
      LIMIT 1
    ` : sql`
      SELECT
        p.id AS policy_id,
        p.name AS policy_name,
        p.content AS policy_content,
        pv."aliasSet" AS policy_alias_set,
        p."userId" AS policy_user_id,
        p."teamId" AS policy_team_id,
        p."isPublic" AS policy_is_public,
        u.plan AS user_plan,
        u."trialEndsAt" AS user_trial_ends_at,
        ur.count AS usage_count,
        CASE WHEN tm.id IS NOT NULL THEN true ELSE false END AS is_team_member
      FROM "Policy" p
      CROSS JOIN "User" u
      -- 活跃版本的冻结 aliasSet（版本号 = Policy.version；与 content 同源）。C1：执行时透传别名。
      LEFT JOIN "PolicyVersion" pv ON pv."policyId" = p.id AND pv.version = p.version
      LEFT JOIN "UsageRecord" ur ON ur."userId" = ${userId}
        AND ur.type = 'execution'
        AND ur.period = ${period}
      LEFT JOIN "TeamMember" tm ON tm."userId" = ${userId}
        AND tm."teamId" = p."teamId"
      WHERE p.id = ${id}
        AND p."deletedAt" IS NULL
        AND u.id = ${userId}
      LIMIT 1
    `);
    timings.dbQueries = Date.now() - tDb;

    // postgres-js returns an array directly
    const rows = result as unknown as UnifiedQueryResult[];
    const row = rows[0];

    // 如果缓存未命中，从数据库结果构建策略对象
    let cacheWritePromise: Promise<void> | null = null;
    if (!cacheHit && row?.policy_id) {
      policy = {
        id: row.policy_id,
        name: row.policy_name!,
        content: row.policy_content!,
        userId: row.policy_user_id!,
        teamId: row.policy_team_id,
        isPublic: row.policy_is_public ?? false,
        aliasSet: row.policy_alias_set ?? null,
      };
      // 保存缓存写入 Promise，稍后通过 waitUntil 执行
      cacheWritePromise = cachePolicyMeta(id, policy).catch(err =>
        console.warn('[Cache] Failed to cache policy:', err)
      );
    }

    const userData = row ? {
      plan: row.user_plan,
      trialEndsAt: row.user_trial_ends_at,
    } : null;

    const usageData = row && row.usage_count !== null ? { count: row.usage_count } : null;
    const isTeamMember = row?.is_team_member ?? false;

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 权限检查（快速路径：所有者或公开策略）
    const isOwner = policy.userId === userId;
    const isPublic = policy.isPublic;

    // 权限验证（团队成员资格已在 SQL 查询中获取）。
    // Slow-path fallback: policy may have been shared with one of
    // the caller's teams via PolicyShare. Only consult that table
    // when the fast path fails — most executions are owner / team-
    // member, and a second query would slow the hot path. The
    // platform admin can disable sharing via the
    // policy_sharing.enabled flag; when OFF, shares are ignored
    // entirely so a leftover row can't grant access.
    // The share's `permission` column gates execute vs view-only.
    // This route requires 'execute'; a 'view'-only share returns
    // 403 (not 404) so the user isn't gaslit about whether the
    // policy exists when they can read it via GET /policies/:id.
    // Pick the highest-tier share if multiple teams of the caller
    // share the same policy (ORDER BY puts 'execute' first).
    let isSharedMember = false;
    if (!isOwner && !isPublic && !isTeamMember) {
      const { isPolicySharingEnabled } = await import(
        '@/lib/platform-settings'
      );
      if (await isPolicySharingEnabled()) {
        const sharedRow = await db.execute<{ permission: string }>(sql`
          SELECT ps."permission" AS permission
          FROM "PolicyShare" ps
          JOIN "TeamMember" tm ON tm."teamId" = ps."teamId"
          WHERE ps."policyId" = ${id}
            AND tm."userId" = ${userId}
          ORDER BY (ps."permission" = 'execute') DESC
          LIMIT 1
        `);
        const sharedRows = sharedRow as unknown as Array<{ permission: string }>;
        const grant = sharedRows[0]?.permission;
        if (grant === 'execute') {
          isSharedMember = true;
        } else if (grant === 'view') {
          return NextResponse.json(
            {
              error: 'Execute not permitted for this share (view-only)',
              code: 'share_view_only',
            },
            { status: 403 },
          );
        }
      }
      if (!isSharedMember) {
        return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      }
    }

    // 团队成员权限检查（仅非所有者，按团队角色判定 execute 权限）
    if (!isOwner && policy.teamId) {
      const t4 = Date.now();
      const permCheck = await checkTeamPermission(userId, policy.teamId, TeamPermission.POLICY_EXECUTE);
      if (!permCheck.allowed) {
        return NextResponse.json({ error: permCheck.error }, { status: permCheck.status });
      }
      timings.permChecks = Date.now() - t4;
    }

    // 策略冻结检查：冻结取决于「策略所有者」的套餐限制，与调用者是否为所有者无关。
    // 所有者套餐降级后超限的策略同样被冻结——所以所有者执行自己的冻结策略也必须拦截。
    // 旧实现把此检查放在 if(!isOwner) 内，导致所有者可执行自己的冻结策略（越权点）。
    // 冻结是「策略状态」级拦截，须先于用量配额检查——避免对一个根本不可运行的
    // 冻结策略报「配额超限(429)」误导用户，正确语义是「策略已冻结(403)」。
    // 性能：调用者即所有者时，统一查询已取到本人 plan/trialEndsAt（= 所有者的），
    // 无需再发一次 users.findFirst（热路径上少一次串行 DB 往返）。仅非所有者执行
    // 他人策略时才补查所有者套餐。
    const ownerData = isOwner
      ? { plan: userData?.plan ?? null, trialEndsAt: userData?.trialEndsAt ?? null }
      : await db.query.users.findFirst({
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

    const currentUsage = usageData?.count || 0;
    if (limits.executions !== -1 && currentUsage >= limits.executions) {
      // 保留 429 状态码（与现有客户端行为一致），body 改用 upgradeResponse 统一格式
      return NextResponse.json(
        upgradeResponse('evaluations', {
          usage: currentUsage,
          limit: limits.executions,
          message: `You've reached your monthly limit of ${limits.executions} executions.`,
        }),
        { status: 429 }
      );
    }

    // 阶段3+4：所有门（权限/冻结/配额）通过后才真正执行策略。
    // 旧实现「乐观执行」在门检查之前就调后端 evaluateSource，导致即使返回
    // 403/429，策略已在后端执行一次（耗资源/可能审计）——冻结策略必须零执行。
    const t3 = Date.now();
    // C1：解析活跃版本冻结的 aliasSet（canonical JSON）透传给执行端，使别名源码能编译。
    // 冻结版本已在创建时经授权+校验+进 envelope，执行端信任应用（allowStructural=true）。
    let parsedAliasSet: Record<string, string[]> | null = null;
    if (policy.aliasSet) {
      try {
        parsedAliasSet = JSON.parse(policy.aliasSet) as Record<string, string[]>;
      } catch {
        parsedAliasSet = null; // 损坏的 aliasSet 视为无别名，不阻塞执行（envelope 另有防篡改）
      }
    }
    const executionResult = await executePolicyUnified({
      policy: policy as Parameters<typeof executePolicyUnified>[0]['policy'],
      input: validatedInput,
      userId,
      tenantId: policy.teamId || policy.userId,
      functionName: functionName || undefined,
      aliasSet: parsedAliasSet,
    });
    timings.executionWait = Date.now() - t3;
    timings.executionTotal = Date.now() - t3;

    const primaryError = getPrimaryError(executionResult);
    const durationMs = Date.now() - startTime;
    const executionId = globalThis.crypto.randomUUID();

    // 异步写入（fire-and-forget）
    const now = new Date();
    const dbWritePromise = Promise.all([
      db.insert(executions).values({
        id: executionId,
        userId,
        policyId: id,
        input: validatedInput as object,
        output: executionResult as object,
        error: primaryError,
        durationMs,
        success: executionResult.allowed ?? false,
        source: 'dashboard',
      }),
      db.insert(usageRecords)
        .values({ id: crypto.randomUUID(), userId, type: 'execution', period, count: 1, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [usageRecords.userId, usageRecords.type, usageRecords.period],
          set: { count: sql`${usageRecords.count} + 1`, updatedAt: now },
        }),
    ]).catch(err => console.error('Failed to record execution:', err));

    // 合并所有后台任务（包括 KV 缓存写入）
    const backgroundTasks = cacheWritePromise
      ? Promise.all([dbWritePromise, cacheWritePromise])
      : dbWritePromise;

    // 使用 OpenNext 的 getCloudflareContext 获取 ctx.waitUntil
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil(backgroundTasks);
    } catch {
      // 非 Cloudflare 环境，直接执行（不阻塞响应）
      void backgroundTasks;
    }

    return NextResponse.json({
      executionId,
      success: executionResult.allowed,
      output: executionResult,
      error: primaryError,
      durationMs,
      executedFunction: executionResult.executedFunction,
      diagnostics: executionResult.diagnostics,
      // 临时添加 timings 用于调试
      _timings: { ...timings, cacheHit },
    });
  } catch (error) {
    console.error('Error executing policy:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: 'Internal server error',
      message: errorMessage,
      debug: process.env.NODE_ENV !== 'production' ? String(error) : undefined,
    }, { status: 500 });
  }
}

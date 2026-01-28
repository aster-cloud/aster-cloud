import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies, executions, users, usageRecords, teamMembers } from '@/lib/prisma';
import { eq, and, isNull, sql, desc, asc } from 'drizzle-orm';
import { PLANS, PlanType } from '@/lib/plans';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';
import { executePolicyUnified, getPrimaryError } from '@/services/policy/cnl-executor';

// Use Node.js runtime for policy execution to avoid Cloudflare Workers CPU limits
// Edge runtime has strict 10-50ms CPU time limits which are exceeded by:
// 1. Complex SQL queries with multiple JOINs
// 2. External HTTP calls to aster-api backend
export const runtime = 'nodejs';

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

    const { input } = bodyResult as { input?: unknown };
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ error: 'Input must be a valid object' }, { status: 400 });
    }

    const validatedInput = input as Record<string, unknown>;
    const userId = session.user.id;
    const period = getCurrentPeriod();

    // 阶段2：单个统一 SQL 查询获取所有数据
    const t2 = Date.now();
    const result = await db.execute<UnifiedQueryResult>(sql`
      SELECT
        p.id AS policy_id,
        p.name AS policy_name,
        p.content AS policy_content,
        p."userId" AS policy_user_id,
        p."teamId" AS policy_team_id,
        p."isPublic" AS policy_is_public,
        u.plan AS user_plan,
        u."trialEndsAt" AS user_trial_ends_at,
        ur.count AS usage_count,
        CASE WHEN tm.id IS NOT NULL THEN true ELSE false END AS is_team_member
      FROM "Policy" p
      CROSS JOIN "User" u
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
    timings.dbQueries = Date.now() - t2;

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
    } : null;

    const userData = row ? {
      plan: row.user_plan,
      trialEndsAt: row.user_trial_ends_at,
    } : null;

    const usageData = row?.usage_count !== null ? { count: row.usage_count } : null;
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

    // 阶段3：乐观执行 - 尽早启动 API 调用
    const t3 = Date.now();
    const executionPromise = executePolicyUnified({
      policy: policy as Parameters<typeof executePolicyUnified>[0]['policy'],
      input: validatedInput,
      userId,
      tenantId: policy.teamId || policy.userId,
    });

    // 配额检查
    const rawPlan = userData?.plan;
    const plan: PlanType = (rawPlan && rawPlan in PLANS ? rawPlan : 'free') as PlanType;
    const trialExpired = plan === 'trial' && userData?.trialEndsAt && userData.trialEndsAt < new Date();
    const effectivePlan: PlanType = trialExpired ? 'free' : plan;
    const limits = PLANS[effectivePlan].limits;

    const currentUsage = usageData?.count || 0;
    if (limits.executions !== -1 && currentUsage >= limits.executions) {
      return NextResponse.json(
        { error: 'Usage limit exceeded', message: `You've reached your monthly limit of ${limits.executions} executions.`, upgrade: true },
        { status: 429 }
      );
    }

    // 仅非所有者需要额外检查
    if (!isOwner) {
      const t4 = Date.now();
      if (policy.teamId) {
        const permCheck = await checkTeamPermission(userId, policy.teamId, TeamPermission.POLICY_EXECUTE);
        if (!permCheck.allowed) {
          return NextResponse.json({ error: permCheck.error }, { status: permCheck.status });
        }
      }

      // 策略冻结检查
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
      timings.permChecks = Date.now() - t4;
    }

    // 阶段4：等待乐观执行结果
    const t5 = Date.now();
    const executionResult = await executionPromise;
    timings.executionWait = Date.now() - t5;
    timings.executionTotal = Date.now() - t3;

    const primaryError = getPrimaryError(executionResult);
    const durationMs = Date.now() - startTime;
    const executionId = globalThis.crypto.randomUUID();

    // 异步写入（fire-and-forget）
    const now = new Date();
    const writePromise = Promise.all([
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

    if (typeof globalThis !== 'undefined' && 'EdgeRuntime' in globalThis) {
      // @ts-expect-error - waitUntil is available in Edge Runtime
      globalThis.waitUntil?.(writePromise);
    } else {
      void writePromise;
    }

    return NextResponse.json({
      executionId,
      success: executionResult.allowed,
      output: executionResult,
      error: primaryError,
      durationMs,
      // 临时添加 timings 用于调试
      _timings: timings,
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

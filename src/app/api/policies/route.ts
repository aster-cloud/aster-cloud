import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies, executions, policyGroups, users, policyVersions } from '@/lib/prisma';
import { getPlanLimit, isUnlimited, PlanType, PLANS } from '@/lib/plans';
import { upgradeResponse, UPGRADE_HTTP_STATUS } from '@/lib/plan-quota';
import { detectPII } from '@/services/pii/detector';
import { getPolicyFreezeStatus } from '@/lib/policy-freeze';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';
import { computeSourceEnvelope, USER_ALIAS_VALIDATOR_VERSION } from '@/lib/policy-alias';
import { eq, isNull, desc, sql, and, inArray } from 'drizzle-orm';

// GET /api/policies - List user's policies
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [policiesData, freezeStatus] = await Promise.all([
      db.query.policies.findMany({
        where: and(eq(policies.userId, session.user.id), isNull(policies.deletedAt)),
        orderBy: [desc(policies.updatedAt)],
        with: {
          group: {
            columns: {
              id: true,
              name: true,
              icon: true,
              parentId: true,
            },
          },
        },
      }),
      getPolicyFreezeStatus(session.user.id),
    ]);

    // 单次查询获取所有 policy 的执行次数
    const policyIds = policiesData.map((p) => p.id);
    const executionCounts: Record<string, number> = {};
    if (policyIds.length > 0) {
      const counts = await db
        .select({
          policyId: executions.policyId,
          count: sql<number>`count(*)::int`,
        })
        .from(executions)
        .where(inArray(executions.policyId, policyIds))
        .groupBy(executions.policyId);
      for (const row of counts) {
        executionCounts[row.policyId] = row.count;
      }
    }
    const policiesWithCount = policiesData.map((policy) => ({
      ...policy,
      _count: { executions: executionCounts[policy.id] ?? 0 },
    }));

    // 添加冻结状态到每个策略
    const policiesWithFreeze = policiesWithCount.map((policy) => ({
      ...policy,
      isFrozen: freezeStatus.frozenPolicyIds.has(policy.id),
    }));

    return NextResponse.json({
      policies: policiesWithFreeze,
      freezeInfo: {
        limit: freezeStatus.limit,
        total: freezeStatus.totalPolicies,
        frozenCount: freezeStatus.frozenCount,
      },
    });
  } catch (error) {
    console.error('Error fetching policies:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/policies - Create a new policy
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, content, description, isPublic, groupId, teamId } =
      await req.json();

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      );
    }

    // When teamId is provided, verify the caller has POLICY_CREATE on
    // that team. This consolidates "create policy under a team" into
    // the same endpoint as personal policies — the team-specific
    // /api/teams/[teamId]/policies route stays available for compat
    // but new UI uses ?teamId= on /policies/new.
    if (teamId) {
      if (typeof teamId !== 'string') {
        return NextResponse.json(
          { error: 'teamId must be a string' },
          { status: 400 }
        );
      }
      const perm = await checkTeamPermission(
        session.user.id,
        teamId,
        TeamPermission.POLICY_CREATE,
      );
      if (!perm.allowed) {
        return NextResponse.json(
          { error: perm.error ?? 'Forbidden' },
          { status: perm.status ?? 403 },
        );
      }
    }

    // 如果指定了分组，验证分组存在且用户有权限
    if (groupId) {
      // 简化查询：先查询用户的分组，再查询团队分组
      let group = await db.query.policyGroups.findFirst({
        where: and(
          eq(policyGroups.id, groupId),
          eq(policyGroups.userId, session.user.id)
        ),
      });

      // 如果不是用户的分组，检查是否是团队成员可访问的分组
      if (!group) {
        // TODO: 需要复杂查询，暂时简化为仅检查用户自己的分组
        // 完整实现需要检查 team.members
        return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      }
    }

    // Check policy limit for free users
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { plan: true, trialEndsAt: true },
    });

    if (user) {
      const plan = (user.plan && user.plan in PLANS ? user.plan : 'free') as PlanType;
      const trialExpired =
        plan === 'trial' && user.trialEndsAt && user.trialEndsAt < new Date();
      const effectivePlan = trialExpired ? 'free' : plan;

      if (trialExpired) {
        await db.update(users).set({ plan: 'free' }).where(eq(users.id, session.user.id));
      }

      const policyLimit = getPlanLimit(effectivePlan, 'policies');
      const [{ count: policyCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(policies)
        .where(and(eq(policies.userId, session.user.id), isNull(policies.deletedAt)));

      if (!isUnlimited(policyLimit) && policyCount >= policyLimit) {
        return NextResponse.json(
          upgradeResponse('published_rules', {
            usage: policyCount,
            limit: policyLimit,
            message: `Current plan allows ${policyLimit} policies. Upgrade for higher limits.`,
          }),
          { status: UPGRADE_HTTP_STATUS }
        );
      }
    }

    const piiResult = detectPII(content);

    // Build insert values, only include groupId if it's a valid non-empty string
    const policyId = globalThis.crypto.randomUUID();

    // Log the values for debugging
    const piiFieldsValue = piiResult.detectedTypes.length > 0 ? piiResult.detectedTypes : null;
    const now = new Date();
    console.log('Insert values:', {
      id: policyId,
      userId: session.user.id,
      name,
      description: description || null,
      isPublic: isPublic || false,
      piiFields: piiFieldsValue,
      groupId: groupId || null,
      createdAt: now,
      updatedAt: now,
    });
    const insertValues: {
      id: string;
      userId: string;
      name: string;
      content: string;
      description?: string | null;
      isPublic: boolean;
      piiFields?: string[] | null;
      groupId?: string | null;
      teamId?: string | null;
      createdAt: Date;
      updatedAt: Date;
    } = {
      id: policyId,
      userId: session.user.id,
      name,
      content,
      description: description || null,
      isPublic: isPublic || false,
      createdAt: now,
      updatedAt: now,
    };

    // Only add piiFields if there are detected types
    if (piiResult.detectedTypes.length > 0) {
      insertValues.piiFields = piiResult.detectedTypes;
    }

    // Only add groupId if it's a valid UUID string
    if (groupId && typeof groupId === 'string' && groupId.trim() !== '') {
      insertValues.groupId = groupId;
    }

    // Team ownership — already permission-checked above.
    if (teamId && typeof teamId === 'string') {
      insertValues.teamId = teamId;
    }

    // Test raw SQL to see if connection works
    try {
      const testResult = await db.execute(sql`SELECT 1 as test`);
      console.log('DB connection test:', testResult);
    } catch (connErr) {
      console.error('DB connection test failed:', connErr);
      throw new Error(`Database connection failed: ${connErr instanceof Error ? connErr.message : String(connErr)}`);
    }

    let policy;
    try {
      const result = await db
        .insert(policies)
        .values(insertValues)
        .returning();
      policy = result[0];
      console.log('Policy insert succeeded:', policy?.id);
    } catch (insertErr) {
      console.error('Policy insert failed:', JSON.stringify(insertErr, Object.getOwnPropertyNames(insertErr as object)));
      throw insertErr;
    }

    // Create initial version.
    // ADR 0022 方案 D：本端点尚不接受用户自定义别名（gated on ts 引擎发版后才开放），故
    // aliasSet 恒为 null；但仍冻结 source envelope（覆盖 content+locale+工具链）使该版本进入
    // 可审计/防篡改体系，与 version-manager 一致。带别名的创建走 version-manager（fail-closed）。
    try {
      const toolchainId = `abi=1.0;core=ts;validator=${USER_ALIAS_VALIDATOR_VERSION};build=${process.env.ASTER_RUNTIME_BUILD ?? 'dev'}`;
      const sourceEnvelopeSha256 = computeSourceEnvelope(content, null, 'en-US', toolchainId);
      await db.insert(policyVersions).values({
        id: globalThis.crypto.randomUUID(),
        policyId: policy.id,
        version: 1,
        content,
        comment: 'Initial version',
        aliasSet: null,
        sourceEnvelopeSha256,
        sourceToolchainId: toolchainId,
        createdAt: new Date(),
      });
      console.log('PolicyVersion insert succeeded');
    } catch (versionErr) {
      console.error('PolicyVersion insert failed:', versionErr);
      throw versionErr;
    }

    return NextResponse.json(policy, { status: 201 });
  } catch (error: unknown) {
    console.error('Error creating policy:', error);
    // Return detailed error info for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    // Try to extract postgres-specific error details (postgres.js uses different error structure)
    const err = error as Record<string, unknown>;
    return NextResponse.json({
      error: 'Internal server error',
      debug: {
        message: errorMessage,
        stack: errorStack,
        name: error instanceof Error ? error.name : typeof error,
        // postgres.js error fields
        code: err?.code,
        severity: err?.severity,
        detail: err?.detail,
        hint: err?.hint,
        position: err?.position,
        constraint: err?.constraint,
        table: err?.table,
        column: err?.column,
        dataType: err?.dataType,
        // Full error keys for debugging
        errorKeys: Object.keys(err || {}),
      }
    }, { status: 500 });
  }
}

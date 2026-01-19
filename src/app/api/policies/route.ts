import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies, executions, policyGroups, users, policyVersions } from '@/lib/prisma';
import { checkUsageLimit } from '@/lib/usage';
import { getPlanLimit, isUnlimited, PlanType, PLANS } from '@/lib/plans';
import { detectPII } from '@/services/pii/detector';
import { addFreezeStatusToPolicies, getPolicyFreezeStatus } from '@/lib/policy-freeze';
import { eq, isNull, desc, sql, and } from 'drizzle-orm';

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

    // 获取每个 policy 的执行次数
    // TODO: 优化为单次查询（使用 SQL GROUP BY 子查询）
    const policiesWithCount = await Promise.all(
      policiesData.map(async (policy) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(executions)
          .where(eq(executions.policyId, policy.id));

        return {
          ...policy,
          _count: { executions: count },
        };
      })
    );

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

    const { name, content, description, isPublic, groupId } = await req.json();

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      );
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
          {
            error: 'Policy limit reached',
            message: `Current plan allows ${policyLimit} policies. Upgrade for higher limits.`,
            upgrade: true,
          },
          { status: 403 }
        );
      }
    }

    const piiResult = detectPII(content);

    // Build insert values, only include groupId if it's a valid non-empty string
    const policyId = globalThis.crypto.randomUUID();

    // Log the values for debugging
    const piiFieldsValue = piiResult.detectedTypes.length > 0 ? piiResult.detectedTypes : null;
    console.log('Insert values:', {
      id: policyId,
      userId: session.user.id,
      name,
      description: description || null,
      isPublic: isPublic || false,
      piiFields: piiFieldsValue,
      groupId: groupId || null,
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
    } = {
      id: policyId,
      userId: session.user.id,
      name,
      content,
      description: description || null,
      isPublic: isPublic || false,
    };

    // Only add piiFields if there are detected types
    if (piiResult.detectedTypes.length > 0) {
      insertValues.piiFields = piiResult.detectedTypes;
    }

    // Only add groupId if it's a valid UUID string
    if (groupId && typeof groupId === 'string' && groupId.trim() !== '') {
      insertValues.groupId = groupId;
    }

    const [policy] = await db
      .insert(policies)
      .values(insertValues)
      .returning();

    // Create initial version
    await db.insert(policyVersions).values({
      id: globalThis.crypto.randomUUID(),
      policyId: policy.id,
      version: 1,
      content,
      comment: 'Initial version',
    });

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

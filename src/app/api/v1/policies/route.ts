import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-keys';
import { db, policies, executions, teamMembers } from '@/lib/prisma';
import { eq, and, isNull, desc, sql, ne } from 'drizzle-orm';
import { checkUsageLimit, recordUsage } from '@/lib/usage';
import { getPolicyFreezeStatus, getBatchPolicyFreezeStatus } from '@/lib/policy-freeze';

// GET /api/v1/policies - List user's policies via API
export async function GET(req: Request) {
  try {
    const auth = await authenticateApiRequest(req);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId } = auth;

    // 检查 API 调用配额
    const apiLimitCheck = await checkUsageLimit(userId, 'api_call');
    if (!apiLimitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'API call limit exceeded',
          message: apiLimitCheck.message,
        },
        { status: 429 }
      );
    }

    // 获取用户自己的策略
    const ownPolicies = await db.query.policies.findMany({
      where: and(
        eq(policies.userId, userId),
        isNull(policies.deletedAt)
      ),
      orderBy: desc(policies.updatedAt),
      columns: {
        id: true,
        name: true,
        description: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 获取用户所在团队的策略(排除自己拥有的)
    const userTeams = await db.query.teamMembers.findMany({
      where: eq(teamMembers.userId, userId),
      columns: { teamId: true },
    });

    const teamIds = userTeams.map(m => m.teamId);
    const teamPolicies = teamIds.length > 0
      ? await db.query.policies.findMany({
          where: and(
            isNull(policies.deletedAt),
            ne(policies.userId, userId),
            sql`${policies.teamId} IN (${sql.join(teamIds.map(id => sql.raw(`'${id}'`)), sql.raw(', '))})`
          ),
          orderBy: desc(policies.updatedAt),
          columns: {
            id: true,
            name: true,
            description: true,
            isPublic: true,
            createdAt: true,
            updatedAt: true,
            userId: true,
            teamId: true,
          },
          with: {
            team: {
              columns: {
                id: true,
                name: true,
              },
            },
          },
        })
      : [];

    // 获取冻结状态
    const freezeStatus = await getPolicyFreezeStatus(userId);

    // 获取团队策略所有者的冻结状态（批量查询优化，避免 N+1 问题）
    const ownerIds = [...new Set(teamPolicies.map((p) => p.userId))];
    const ownerFreezeMap = await getBatchPolicyFreezeStatus(ownerIds);

    // 获取每个策略的执行次数
    const ownPoliciesWithCount = await Promise.all(
      ownPolicies.map(async (policy) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(executions)
          .where(eq(executions.policyId, policy.id));

        return {
          id: policy.id,
          name: policy.name,
          description: policy.description,
          isPublic: policy.isPublic,
          isFrozen: freezeStatus.frozenPolicyIds.has(policy.id),
          executionCount: count,
          createdAt: policy.createdAt.toISOString(),
          updatedAt: policy.updatedAt.toISOString(),
          source: 'own' as const,
        };
      })
    );

    const teamPoliciesWithInfo = await Promise.all(
      teamPolicies.map(async (policy) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(executions)
          .where(eq(executions.policyId, policy.id));

        // 根据策略所有者的冻结状态判断
        const ownerFrozenIds = ownerFreezeMap.get(policy.userId) || new Set();
        return {
          id: policy.id,
          name: policy.name,
          description: policy.description,
          isPublic: policy.isPublic,
          isFrozen: ownerFrozenIds.has(policy.id),
          executionCount: count,
          createdAt: policy.createdAt.toISOString(),
          updatedAt: policy.updatedAt.toISOString(),
          source: 'team' as const,
          teamId: policy.teamId,
          teamName: policy.team?.name,
        };
      })
    );

    const policiesWithFreeze = [...ownPoliciesWithCount, ...teamPoliciesWithInfo];

    // 记录 API 调用
    await recordUsage(userId, 'api_call');

    return NextResponse.json({
      policies: policiesWithFreeze,
      meta: {
        total: policiesWithFreeze.length,
        ownCount: ownPolicies.length,
        teamCount: teamPolicies.length,
        limit: freezeStatus.limit,
        frozenCount: freezeStatus.frozenCount,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('API list policies error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

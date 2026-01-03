import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
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

    // 获取用户自己的策略和团队策略
    const [ownPolicies, teamPolicies, freezeStatus] = await Promise.all([
      prisma.policy.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          isPublic: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { executions: true },
          },
        },
      }),
      prisma.policy.findMany({
        where: {
          team: {
            members: {
              some: { userId },
            },
          },
          userId: { not: userId }, // 排除自己拥有的（已在 ownPolicies 中）
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          isPublic: true,
          createdAt: true,
          updatedAt: true,
          userId: true,
          teamId: true,
          team: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: { executions: true },
          },
        },
      }),
      getPolicyFreezeStatus(userId),
    ]);

    // 获取团队策略所有者的冻结状态（批量查询优化，避免 N+1 问题）
    const ownerIds = [...new Set(teamPolicies.map((p) => p.userId))];
    const ownerFreezeMap = await getBatchPolicyFreezeStatus(ownerIds);

    // 添加冻结状态和来源信息到每个策略
    const ownPoliciesWithFreeze = ownPolicies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      description: policy.description,
      isPublic: policy.isPublic,
      isFrozen: freezeStatus.frozenPolicyIds.has(policy.id),
      executionCount: policy._count.executions,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
      source: 'own' as const,
    }));

    const teamPoliciesWithInfo = teamPolicies.map((policy) => {
      // 根据策略所有者的冻结状态判断
      const ownerFrozenIds = ownerFreezeMap.get(policy.userId) || new Set();
      return {
        id: policy.id,
        name: policy.name,
        description: policy.description,
        isPublic: policy.isPublic,
        isFrozen: ownerFrozenIds.has(policy.id),
        executionCount: policy._count.executions,
        createdAt: policy.createdAt.toISOString(),
        updatedAt: policy.updatedAt.toISOString(),
        source: 'team' as const,
        teamId: policy.teamId,
        teamName: policy.team?.name,
      };
    });

    const policiesWithFreeze = [...ownPoliciesWithFreeze, ...teamPoliciesWithInfo];

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

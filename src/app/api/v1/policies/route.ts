import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, recordUsage } from '@/lib/usage';
import { getPolicyFreezeStatus } from '@/lib/policy-freeze';

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

    const [policies, freezeStatus] = await Promise.all([
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
      getPolicyFreezeStatus(userId),
    ]);

    // 添加冻结状态到每个策略
    const policiesWithFreeze = policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      description: policy.description,
      isPublic: policy.isPublic,
      isFrozen: freezeStatus.frozenPolicyIds.has(policy.id),
      executionCount: policy._count.executions,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    }));

    // 记录 API 调用
    await recordUsage(userId, 'api_call');

    return NextResponse.json({
      policies: policiesWithFreeze,
      meta: {
        total: policies.length,
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

import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, recordUsage } from '@/lib/usage';
import { getPolicyFreezeStatus } from '@/lib/policy-freeze';

// GET /api/v1/policies - List user's policies via API
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 }
      );
    }

    const apiKey = authHeader.substring(7);
    const validation = await validateApiKey(apiKey);

    if (!validation.valid || !validation.userId) {
      return NextResponse.json({ error: validation.error }, { status: 401 });
    }

    // 检查 API 调用配额
    const apiLimitCheck = await checkUsageLimit(validation.userId, 'api_call');
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
        where: { userId: validation.userId },
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
      getPolicyFreezeStatus(validation.userId),
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
    await recordUsage(validation.userId, 'api_call');

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

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { detectPII } from '@/services/pii/detector';
import { isPolicyFrozen } from '@/lib/policy-freeze';
import { softDeletePolicy } from '@/lib/policy-lifecycle';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/policies/[id] - Get a single policy
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const policy = await prisma.policy.findFirst({
      where: {
        id,
        deletedAt: null, // 排除已删除的策略
        OR: [
          { userId: session.user.id },
          { isPublic: true },
          {
            team: {
              members: {
                some: { userId: session.user.id },
              },
            },
          },
        ],
      },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 10,
        },
        _count: {
          select: { executions: true },
        },
      },
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 检查策略是否被冻结（只对策略所有者检查）
    let freezeInfo = null;
    if (policy.userId === session.user.id) {
      freezeInfo = await isPolicyFrozen(session.user.id, id);
    }

    return NextResponse.json({
      ...policy,
      isFrozen: freezeInfo?.isFrozen ?? false,
      freezeInfo: freezeInfo
        ? {
            reason: freezeInfo.reason,
            limit: freezeInfo.activePoliciesLimit,
            total: freezeInfo.totalPolicies,
            frozenCount: freezeInfo.frozenCount,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/policies/[id] - Update a policy
export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { name, content, description, isPublic, groupId } = await req.json();

    // Check ownership (exclude deleted policies)
    const existingPolicy = await prisma.policy.findFirst({
      where: {
        id,
        userId: session.user.id,
        deletedAt: null,
      },
    });

    if (!existingPolicy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 检查策略是否被冻结
    const freezeInfo = await isPolicyFrozen(session.user.id, id);
    if (freezeInfo.isFrozen) {
      return NextResponse.json(
        {
          error: 'Policy is frozen',
          message: `This policy is frozen because your plan allows ${freezeInfo.activePoliciesLimit} policies but you have ${freezeInfo.totalPolicies}. Delete some policies or upgrade your plan.`,
          frozen: true,
        },
        { status: 403 }
      );
    }

    // Update policy and create new version if content changed
    const newVersion = content !== existingPolicy.content;

    const piiResult = newVersion ? detectPII(content) : null;

    const policy = await prisma.policy.update({
      where: { id },
      data: {
        name,
        content,
        description,
        isPublic,
        version: newVersion ? { increment: 1 } : undefined,
        piiFields: newVersion ? piiResult?.detectedTypes : undefined,
        ...(groupId !== undefined && { groupId: groupId || null }),
      },
    });

    if (newVersion) {
      await prisma.policyVersion.create({
        data: {
          policyId: id,
          version: policy.version,
          content,
        },
      });
    }

    return NextResponse.json(policy);
  } catch (error) {
    console.error('Error updating policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/policies/[id] - Soft delete a policy (move to trash)
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // 解析可选的删除原因
    let reason: string | undefined;
    try {
      const body = await req.json();
      reason = body?.reason;
    } catch {
      // 无请求体，忽略
    }

    // 使用软删除
    const result = await softDeletePolicy(id, session.user.id, reason);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Policy moved to trash. It will be permanently deleted after 30 days.',
    });
  } catch (error) {
    console.error('Error deleting policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

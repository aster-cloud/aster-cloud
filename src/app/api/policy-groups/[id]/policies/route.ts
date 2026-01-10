import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/policy-groups/[id]/policies - 批量添加策略到分组
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: groupId } = await params;
    const { policyIds } = await req.json();

    if (!Array.isArray(policyIds) || policyIds.length === 0) {
      return NextResponse.json({ error: 'Policy IDs array is required' }, { status: 400 });
    }

    // 验证分组存在且用户有权限
    const group = await prisma.policyGroup.findFirst({
      where: {
        id: groupId,
        OR: [
          { userId: session.user.id },
          {
            team: {
              members: {
                some: { userId: session.user.id },
              },
            },
          },
        ],
      },
    });

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // 验证所有策略都属于当前用户
    const policies = await prisma.policy.findMany({
      where: {
        id: { in: policyIds },
        userId: session.user.id,
        deletedAt: null,
      },
      select: { id: true },
    });

    const foundIds = new Set(policies.map((p) => p.id));
    const notFoundIds = policyIds.filter((id: string) => !foundIds.has(id));

    if (notFoundIds.length > 0) {
      return NextResponse.json(
        { error: `Policies not found: ${notFoundIds.join(', ')}` },
        { status: 404 }
      );
    }

    // 批量更新策略的分组
    await prisma.policy.updateMany({
      where: {
        id: { in: policyIds },
        userId: session.user.id,
      },
      data: { groupId },
    });

    return NextResponse.json({
      success: true,
      count: policyIds.length,
    });
  } catch (error) {
    console.error('Error adding policies to group:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/policy-groups/[id]/policies - 批量从分组移除策略
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: groupId } = await params;
    const { policyIds } = await req.json();

    if (!Array.isArray(policyIds) || policyIds.length === 0) {
      return NextResponse.json({ error: 'Policy IDs array is required' }, { status: 400 });
    }

    // 验证分组存在且用户有权限
    const group = await prisma.policyGroup.findFirst({
      where: {
        id: groupId,
        OR: [
          { userId: session.user.id },
          {
            team: {
              members: {
                some: { userId: session.user.id },
              },
            },
          },
        ],
      },
    });

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // 批量移除策略的分组关联（设为 null）
    await prisma.policy.updateMany({
      where: {
        id: { in: policyIds },
        userId: session.user.id,
        groupId,
      },
      data: { groupId: null },
    });

    return NextResponse.json({
      success: true,
      count: policyIds.length,
    });
  } catch (error) {
    console.error('Error removing policies from group:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

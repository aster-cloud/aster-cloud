import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// POST /api/policy-groups/reorder - 批量更新分组排序
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { orders } = await req.json();

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ error: 'Orders array is required' }, { status: 400 });
    }

    // 验证所有分组都属于当前用户或其团队
    const groupIds = orders.map((o: { id: string }) => o.id);
    const groups = await prisma.policyGroup.findMany({
      where: {
        id: { in: groupIds },
        OR: [
          { userId: session.user.id },
          {
            team: {
              members: {
                some: {
                  userId: session.user.id,
                  role: { in: ['owner', 'admin'] },
                },
              },
            },
          },
        ],
      },
      select: { id: true, isSystem: true },
    });

    // 检查是否所有请求的分组都找到了
    const foundIds = new Set(groups.map((g) => g.id));
    const notFoundIds = groupIds.filter((id: string) => !foundIds.has(id));
    if (notFoundIds.length > 0) {
      return NextResponse.json(
        { error: `Groups not found or no permission: ${notFoundIds.join(', ')}` },
        { status: 404 }
      );
    }

    // 检查是否有系统分组
    const systemGroups = groups.filter((g) => g.isSystem);
    if (systemGroups.length > 0) {
      return NextResponse.json({ error: 'Cannot reorder system groups' }, { status: 403 });
    }

    // 批量更新排序
    await prisma.$transaction(
      orders.map((order: { id: string; sortOrder: number; parentId?: string }) =>
        prisma.policyGroup.update({
          where: { id: order.id },
          data: {
            sortOrder: order.sortOrder,
            ...(order.parentId !== undefined && { parentId: order.parentId }),
          },
        })
      )
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reordering policy groups:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

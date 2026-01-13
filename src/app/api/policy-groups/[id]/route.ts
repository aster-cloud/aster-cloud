import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/policy-groups/[id] - 获取单个分组详情
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const group = await prisma.policyGroup.findFirst({
      where: {
        id,
        OR: [
          { userId: session.user.id },
          { isSystem: true },
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
        children: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            _count: {
              select: {
                policies: { where: { deletedAt: null } },
              },
            },
          },
        },
        policies: {
          where: { deletedAt: null },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            name: true,
            description: true,
            updatedAt: true,
          },
        },
        _count: {
          select: {
            policies: { where: { deletedAt: null } },
            children: true,
          },
        },
      },
    });

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    return NextResponse.json(group);
  } catch (error) {
    console.error('Error fetching policy group:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/policy-groups/[id] - 更新分组
export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { name, description, icon, parentId, sortOrder } = await req.json();

    // 验证分组存在且用户有权限
    const existingGroup = await prisma.policyGroup.findFirst({
      where: {
        id,
        OR: [
          { userId: session.user.id },
          {
            team: {
              members: {
                some: {
                  userId: session.user.id,
                  role: { in: ['owner', 'admin'] }, // 只有 owner 和 admin 可以修改
                },
              },
            },
          },
        ],
      },
    });

    if (!existingGroup) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // 系统分组不允许修改
    if (existingGroup.isSystem) {
      return NextResponse.json({ error: 'Cannot modify system group' }, { status: 403 });
    }

    // 如果要修改父分组，验证不会造成循环引用
    if (parentId !== undefined && parentId !== existingGroup.parentId) {
      if (parentId === id) {
        return NextResponse.json({ error: 'Group cannot be its own parent' }, { status: 400 });
      }

      // 检查新父分组是否是当前分组的子孙
      if (parentId) {
        const isDescendant = await checkIsDescendant(id, parentId);
        if (isDescendant) {
          return NextResponse.json(
            { error: 'Cannot move group to its own descendant' },
            { status: 400 }
          );
        }
      }
    }

    const group = await prisma.policyGroup.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
        ...(parentId !== undefined && { parentId }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
      include: {
        _count: {
          select: {
            policies: { where: { deletedAt: null } },
          },
        },
      },
    });

    return NextResponse.json(group);
  } catch (error) {
    console.error('Error updating policy group:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/policy-groups/[id] - 删除分组
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // 验证分组存在且用户有权限
    const group = await prisma.policyGroup.findFirst({
      where: {
        id,
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
      include: {
        _count: {
          select: {
            policies: { where: { deletedAt: null } },
            children: true,
          },
        },
      },
    });

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // 系统分组不允许删除
    if (group.isSystem) {
      return NextResponse.json({ error: 'Cannot delete system group' }, { status: 403 });
    }

    // 解析请求体，获取删除选项
    let movePoliciesToParent = true;
    let moveChildrenToParent = true;
    try {
      const body = await req.json();
      movePoliciesToParent = body?.movePoliciesToParent ?? true;
      moveChildrenToParent = body?.moveChildrenToParent ?? true;
    } catch {
      // 无请求体，使用默认值
    }

    // 使用事务处理删除
    await prisma.$transaction(async (tx) => {
      // 处理策略：移动到父分组或取消分组
      if (group._count.policies > 0) {
        await tx.policy.updateMany({
          where: { groupId: id },
          data: { groupId: movePoliciesToParent ? group.parentId : null },
        });
      }

      // 处理子分组：移动到父分组或提升为顶级分组
      if (group._count.children > 0) {
        await tx.policyGroup.updateMany({
          where: { parentId: id },
          data: { parentId: moveChildrenToParent ? group.parentId : null },
        });
      }

      // 删除分组
      await tx.policyGroup.delete({
        where: { id },
      });
    });

    return NextResponse.json({
      success: true,
      message: 'Group deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting policy group:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 辅助函数：检查 targetId 是否是 sourceId 的子孙节点
async function checkIsDescendant(sourceId: string, targetId: string): Promise<boolean> {
  const children = await prisma.policyGroup.findMany({
    where: { parentId: sourceId },
    select: { id: true },
  });

  for (const child of children) {
    if (child.id === targetId) {
      return true;
    }
    const isDescendant = await checkIsDescendant(child.id, targetId);
    if (isDescendant) {
      return true;
    }
  }

  return false;
}

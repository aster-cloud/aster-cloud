import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policyGroups, policies, teamMembers } from '@/lib/prisma';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';

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

    // 先查用户自己的分组或系统分组
    let group = await db.query.policyGroups.findFirst({
      where: and(
        eq(policyGroups.id, id),
        sql`(${policyGroups.userId} = ${session.user.id} OR ${policyGroups.isSystem} = true)`
      ),
    });

    // 如果不是用户的分组,检查是否是团队分组
    if (!group) {
      const userTeams = await db.query.teamMembers.findMany({
        where: eq(teamMembers.userId, session.user.id),
        columns: { teamId: true },
      });

      if (userTeams.length > 0) {
        const teamIds = userTeams.map(m => m.teamId);
        group = await db.query.policyGroups.findFirst({
          where: and(
            eq(policyGroups.id, id),
            sql`${policyGroups.teamId} IN (${sql.join(teamIds.map(tid => sql.raw(`'${tid}'`)), sql.raw(', '))})`
          ),
        });
      }
    }

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // 获取子分组
    const children = await db.query.policyGroups.findMany({
      where: eq(policyGroups.parentId, id),
      orderBy: [sql`${policyGroups.sortOrder} ASC`, sql`${policyGroups.name} ASC`],
    });

    // 为每个子分组获取策略计数
    const childrenWithCount = await Promise.all(
      children.map(async (child) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(policies)
          .where(and(
            eq(policies.groupId, child.id),
            isNull(policies.deletedAt)
          ));

        return {
          ...child,
          _count: { policies: count },
        };
      })
    );

    // 获取当前分组的策略
    const groupPolicies = await db.query.policies.findMany({
      where: and(
        eq(policies.groupId, id),
        isNull(policies.deletedAt)
      ),
      orderBy: desc(policies.updatedAt),
      columns: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
      },
    });

    // 获取计数
    const [policyCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(and(
        eq(policies.groupId, id),
        isNull(policies.deletedAt)
      ));

    const [childrenCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(policyGroups)
      .where(eq(policyGroups.parentId, id));

    return NextResponse.json({
      ...group,
      children: childrenWithCount,
      policies: groupPolicies,
      _count: {
        policies: policyCount.count,
        children: childrenCount.count,
      },
    });
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
    // 先查用户自己的分组
    let existingGroup = await db.query.policyGroups.findFirst({
      where: and(
        eq(policyGroups.id, id),
        eq(policyGroups.userId, session.user.id)
      ),
    });

    // 如果不是用户的分组,检查团队权限(owner/admin)
    if (!existingGroup) {
      const adminTeams = await db.query.teamMembers.findMany({
        where: and(
          eq(teamMembers.userId, session.user.id),
          sql`${teamMembers.role} IN ('owner', 'admin')`
        ),
        columns: { teamId: true },
      });

      if (adminTeams.length > 0) {
        const adminTeamIds = adminTeams.map(t => t.teamId);
        existingGroup = await db.query.policyGroups.findFirst({
          where: and(
            eq(policyGroups.id, id),
            sql`${policyGroups.teamId} IN (${sql.join(adminTeamIds.map(tid => sql.raw(`'${tid}'`)), sql.raw(', '))})`
          ),
        });
      }
    }

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

    // 构建更新数据
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (icon !== undefined) updateData.icon = icon;
    if (parentId !== undefined) updateData.parentId = parentId || null;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;

    const [group] = await db
      .update(policyGroups)
      .set(updateData)
      .where(eq(policyGroups.id, id))
      .returning();

    // 获取策略计数
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(and(
        eq(policies.groupId, group.id),
        isNull(policies.deletedAt)
      ));

    return NextResponse.json({ ...group, _count: { policies: count } });
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
    let group = await db.query.policyGroups.findFirst({
      where: and(
        eq(policyGroups.id, id),
        eq(policyGroups.userId, session.user.id)
      ),
    });

    // 如果不是用户的分组,检查团队权限
    if (!group) {
      const adminTeams = await db.query.teamMembers.findMany({
        where: and(
          eq(teamMembers.userId, session.user.id),
          sql`${teamMembers.role} IN ('owner', 'admin')`
        ),
        columns: { teamId: true },
      });

      if (adminTeams.length > 0) {
        const adminTeamIds = adminTeams.map(t => t.teamId);
        group = await db.query.policyGroups.findFirst({
          where: and(
            eq(policyGroups.id, id),
            sql`${policyGroups.teamId} IN (${sql.join(adminTeamIds.map(tid => sql.raw(`'${tid}'`)), sql.raw(', '))})`
          ),
        });
      }
    }

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    // 系统分组不允许删除
    if (group.isSystem) {
      return NextResponse.json({ error: 'Cannot delete system group' }, { status: 403 });
    }

    // 获取计数
    const [policyCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(and(
        eq(policies.groupId, id),
        isNull(policies.deletedAt)
      ));

    const [childrenCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(policyGroups)
      .where(eq(policyGroups.parentId, id));

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
    await db.transaction(async (tx) => {
      // 处理策略：移动到父分组或取消分组
      if (policyCount.count > 0) {
        await tx
          .update(policies)
          .set({ groupId: movePoliciesToParent ? group.parentId : null })
          .where(eq(policies.groupId, id));
      }

      // 处理子分组：移动到父分组或提升为顶级分组
      if (childrenCount.count > 0) {
        await tx
          .update(policyGroups)
          .set({ parentId: moveChildrenToParent ? group.parentId : null })
          .where(eq(policyGroups.parentId, id));
      }

      // 删除分组
      await tx.delete(policyGroups).where(eq(policyGroups.id, id));
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
  const children = await db.query.policyGroups.findMany({
    where: eq(policyGroups.parentId, sourceId),
    columns: { id: true },
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

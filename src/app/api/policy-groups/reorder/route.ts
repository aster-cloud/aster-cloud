import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policyGroups, teamMembers } from '@/lib/prisma';
import { eq, and, inArray, sql } from 'drizzle-orm';

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

    // 查询用户自己的分组
    const userGroups = await db.query.policyGroups.findMany({
      where: and(
        inArray(policyGroups.id, groupIds),
        eq(policyGroups.userId, session.user.id)
      ),
      columns: { id: true, isSystem: true },
    });

    // 查询用户作为owner/admin的团队分组
    const adminTeams = await db.query.teamMembers.findMany({
      where: and(
        eq(teamMembers.userId, session.user.id),
        sql`${teamMembers.role} IN ('owner', 'admin')`
      ),
      columns: { teamId: true },
    });

    const adminTeamIds = adminTeams.map(t => t.teamId);
    const teamGroups = adminTeamIds.length > 0
      ? await db.query.policyGroups.findMany({
          where: and(
            inArray(policyGroups.id, groupIds),
            sql`${policyGroups.teamId} IN (${sql.join(adminTeamIds.map(id => sql.raw(`'${id}'`)), sql.raw(', '))})`
          ),
          columns: { id: true, isSystem: true },
        })
      : [];

    const groups = [...userGroups, ...teamGroups];

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
    await db.transaction(async (tx) => {
      for (const order of orders as Array<{ id: string; sortOrder: number; parentId?: string }>) {
        const updateData: { sortOrder: number; parentId?: string | null } = {
          sortOrder: order.sortOrder,
        };
        if (order.parentId !== undefined) {
          updateData.parentId = order.parentId || null;
        }
        await tx.update(policyGroups).set(updateData).where(eq(policyGroups.id, order.id));
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reordering policy groups:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

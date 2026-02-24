import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policyGroups, policies, teamMembers } from '@/lib/prisma';
import { eq, and, isNull, sql, asc, inArray } from 'drizzle-orm';


// GET /api/policy-groups - 获取用户的策略分组树
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 获取用户的所有分组（包括个人和团队的）
    // Drizzle 的复杂 OR 查询需要分步处理
    const userGroups = await db.query.policyGroups.findMany({
      where: eq(policyGroups.userId, session.user.id),
      orderBy: [asc(policyGroups.sortOrder), asc(policyGroups.name)],
    });

    const systemGroups = await db.query.policyGroups.findMany({
      where: eq(policyGroups.isSystem, true),
      orderBy: [asc(policyGroups.sortOrder), asc(policyGroups.name)],
    });

    // 查询用户所在团队的分组
    const userTeamMemberships = await db.query.teamMembers.findMany({
      where: eq(teamMembers.userId, session.user.id),
      columns: { teamId: true },
    });

    const teamIds = userTeamMemberships.map(m => m.teamId);
    const teamGroups = teamIds.length > 0
      ? await db.query.policyGroups.findMany({
          where: inArray(policyGroups.teamId, teamIds),
          orderBy: [asc(policyGroups.sortOrder), asc(policyGroups.name)],
        })
      : [];

    // 合并去重
    const groupsMap = new Map();
    [...userGroups, ...systemGroups, ...teamGroups].forEach(g => {
      if (!groupsMap.has(g.id)) {
        groupsMap.set(g.id, g);
      }
    });

    const allGroups = Array.from(groupsMap.values());

    // 获取每个分组的策略计数
    const groupsWithCount = await Promise.all(
      allGroups.map(async (group) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(policies)
          .where(and(
            eq(policies.groupId, group.id),
            isNull(policies.deletedAt)
          ));

        return {
          ...group,
          _count: { policies: count },
        };
      })
    );

    const groups = groupsWithCount;

    // 构建树形结构
    const groupMap = new Map(groups.map((g) => [g.id, { ...g, children: [] as typeof groups }]));
    const rootGroups: typeof groups = [];

    for (const group of groups) {
      if (group.parentId && groupMap.has(group.parentId)) {
        const parent = groupMap.get(group.parentId);
        if (parent) {
          (parent.children as typeof groups).push(groupMap.get(group.id)!);
        }
      } else {
        rootGroups.push(groupMap.get(group.id)!);
      }
    }

    return NextResponse.json({
      groups: rootGroups,
      flatGroups: groups, // 同时返回平铺列表，方便前端某些场景使用
    });
  } catch (error) {
    console.error('Error fetching policy groups:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/policy-groups - 创建新分组
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, description, icon, parentId, teamId } = await req.json();

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // 如果指定了父分组，验证其存在且用户有权限
    if (parentId) {
      // 先查用户自己的分组
      let parentGroup = await db.query.policyGroups.findFirst({
        where: and(
          eq(policyGroups.id, parentId),
          eq(policyGroups.userId, session.user.id)
        ),
      });

      // 如果不是用户的分组,检查是否是团队分组
      if (!parentGroup) {
        const userTeams = await db.query.teamMembers.findMany({
          where: eq(teamMembers.userId, session.user.id),
          columns: { teamId: true },
        });

        if (userTeams.length > 0) {
          const memberTeamIds = userTeams.map(m => m.teamId);
          parentGroup = await db.query.policyGroups.findFirst({
            where: and(
              eq(policyGroups.id, parentId),
              inArray(policyGroups.teamId, memberTeamIds)
            ),
          });
        }
      }

      if (!parentGroup) {
        return NextResponse.json({ error: 'Parent group not found' }, { status: 404 });
      }
    }

    // 如果指定了团队，验证用户是团队成员
    if (teamId) {
      const membership = await db.query.teamMembers.findFirst({
        where: and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, session.user.id)
        ),
      });

      if (!membership) {
        return NextResponse.json({ error: 'Not a team member' }, { status: 403 });
      }
    }

    // 获取同级分组的最大排序值
    const maxResult = await db
      .select({ max: sql<number | null>`MAX(${policyGroups.sortOrder})` })
      .from(policyGroups)
      .where(and(
        parentId ? eq(policyGroups.parentId, parentId) : isNull(policyGroups.parentId),
        teamId ? eq(policyGroups.teamId, teamId) : eq(policyGroups.userId, session.user.id)
      ));

    const maxSortOrder = maxResult[0]?.max ?? 0;

    const [group] = await db
      .insert(policyGroups)
      .values({
        id: globalThis.crypto.randomUUID(),
        name,
        description: description || null,
        icon: icon || null,
        parentId: parentId || null,
        sortOrder: maxSortOrder + 1,
        teamId: teamId || null,
        userId: teamId ? null : session.user.id,
      })
      .returning();

    // 获取策略计数
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(and(
        eq(policies.groupId, group.id),
        isNull(policies.deletedAt)
      ));

    return NextResponse.json({ ...group, _count: { policies: count } }, { status: 201 });
  } catch (error) {
    console.error('Error creating policy group:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

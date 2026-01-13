import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/policy-groups - 获取用户的策略分组树
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 获取用户的所有分组（包括个人和团队的）
    const groups = await prisma.policyGroup.findMany({
      where: {
        OR: [
          { userId: session.user.id },
          { isSystem: true }, // 系统预设分组对所有用户可见
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
        _count: {
          select: {
            policies: { where: { deletedAt: null } },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

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
      const parentGroup = await prisma.policyGroup.findFirst({
        where: {
          id: parentId,
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

      if (!parentGroup) {
        return NextResponse.json({ error: 'Parent group not found' }, { status: 404 });
      }
    }

    // 如果指定了团队，验证用户是团队成员
    if (teamId) {
      const membership = await prisma.teamMember.findFirst({
        where: {
          teamId,
          userId: session.user.id,
        },
      });

      if (!membership) {
        return NextResponse.json({ error: 'Not a team member' }, { status: 403 });
      }
    }

    // 获取同级分组的最大排序值
    const maxSortOrder = await prisma.policyGroup.aggregate({
      where: {
        parentId: parentId || null,
        ...(teamId ? { teamId } : { userId: session.user.id }),
      },
      _max: { sortOrder: true },
    });

    const group = await prisma.policyGroup.create({
      data: {
        name,
        description,
        icon,
        parentId,
        sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1,
        ...(teamId ? { teamId } : { userId: session.user.id }),
      },
      include: {
        _count: {
          select: {
            policies: { where: { deletedAt: null } },
          },
        },
      },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    console.error('Error creating policy group:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';
import { validateTeamName, validateSlug } from '@/lib/validation';

type RouteParams = { params: Promise<{ teamId: string }> };

// GET /api/teams/[teamId] - 获取团队详情
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查访问权限
    const permission = await checkTeamPermission(session.user.id, teamId, TeamPermission.TEAM_VIEW);
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          where: { userId: session.user.id },
          select: { role: true },
        },
        _count: {
          select: {
            members: true,
            policies: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (!team) {
      return NextResponse.json({ error: '团队不存在' }, { status: 404 });
    }

    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        ownerId: team.ownerId,
        memberCount: team._count.members,
        policyCount: team._count.policies,
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
      },
      role: team.members[0]?.role,
    });
  } catch (error) {
    console.error('Error getting team:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// PUT /api/teams/[teamId] - 更新团队设置
export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查更新权限
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.TEAM_UPDATE
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    const { name, slug } = await req.json();
    const updateData: { name?: string; slug?: string } = {};

    // 验证并更新名称
    if (name !== undefined) {
      const nameValidation = validateTeamName(name);
      if (!nameValidation.valid) {
        return NextResponse.json({ error: nameValidation.error }, { status: 400 });
      }
      updateData.name = name;
    }

    // 验证并更新 slug
    if (slug !== undefined) {
      const slugValidation = validateSlug(slug);
      if (!slugValidation.valid) {
        return NextResponse.json({ error: slugValidation.error }, { status: 400 });
      }

      // 检查 slug 唯一性（排除当前团队）
      const existingTeam = await prisma.team.findFirst({
        where: { slug, id: { not: teamId } },
      });
      if (existingTeam) {
        return NextResponse.json({ error: '此 slug 已被使用' }, { status: 400 });
      }
      updateData.slug = slug;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有提供要更新的字段' }, { status: 400 });
    }

    const team = await prisma.team.update({
      where: { id: teamId },
      data: updateData,
    });

    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        updatedAt: team.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error updating team:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/teams/[teamId] - 删除团队
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查删除权限（仅限 Owner）
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.TEAM_DELETE
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    // 删除团队（级联删除成员和邀请）
    await prisma.team.delete({ where: { id: teamId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting team:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

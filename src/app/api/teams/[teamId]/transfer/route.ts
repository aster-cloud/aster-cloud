import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';

type RouteParams = { params: Promise<{ teamId: string }> };

// POST /api/teams/[teamId]/transfer - 转让团队所有权
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查转让权限（仅限 Owner）
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.TEAM_TRANSFER
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    const { newOwnerId } = await req.json();

    if (!newOwnerId || typeof newOwnerId !== 'string') {
      return NextResponse.json({ error: '请指定新的所有者' }, { status: 400 });
    }

    // 检查新所有者是否为团队成员
    const newOwnerMembership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: newOwnerId,
        },
      },
    });

    if (!newOwnerMembership) {
      return NextResponse.json({ error: '新所有者必须是团队成员' }, { status: 400 });
    }

    // 不能转让给自己
    if (newOwnerId === session.user.id) {
      return NextResponse.json({ error: '无法将所有权转让给自己' }, { status: 400 });
    }

    // 使用事务更新所有权
    await prisma.$transaction([
      // 更新团队的 ownerId
      prisma.team.update({
        where: { id: teamId },
        data: { ownerId: newOwnerId },
      }),
      // 将新所有者角色更新为 owner
      prisma.teamMember.update({
        where: {
          teamId_userId: {
            teamId,
            userId: newOwnerId,
          },
        },
        data: { role: 'owner' },
      }),
      // 将原所有者角色降级为 admin
      prisma.teamMember.update({
        where: {
          teamId_userId: {
            teamId,
            userId: session.user.id,
          },
        },
        data: { role: 'admin' },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: '所有权转让成功',
      newOwnerId,
    });
  } catch (error) {
    console.error('Error transferring team ownership:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

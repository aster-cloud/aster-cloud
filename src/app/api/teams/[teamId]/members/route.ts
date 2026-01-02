import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';

type RouteParams = { params: Promise<{ teamId: string }> };

// GET /api/teams/[teamId]/members - 列出团队成员
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查访问权限
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.MEMBER_VIEW
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
      orderBy: [
        { role: 'asc' }, // owner 在前
        { createdAt: 'asc' },
      ],
    });

    return NextResponse.json({
      members: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        user: {
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          image: member.user.image,
        },
        role: member.role,
        joinedAt: member.createdAt.toISOString(),
      })),
      currentUserId: session.user.id,
    });
  } catch (error) {
    console.error('Error listing team members:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

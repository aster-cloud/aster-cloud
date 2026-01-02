import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';

type RouteParams = { params: Promise<{ teamId: string; invitationId: string }> };

// DELETE /api/teams/[teamId]/invitations/[invitationId] - 撤销邀请
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId, invitationId } = await params;

    // 检查撤销邀请的权限
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.INVITATION_REVOKE
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    // 获取邀请
    const invitation = await prisma.teamInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation || invitation.teamId !== teamId) {
      return NextResponse.json({ error: '邀请不存在' }, { status: 404 });
    }

    // 删除邀请
    await prisma.teamInvitation.delete({ where: { id: invitationId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error revoking invitation:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

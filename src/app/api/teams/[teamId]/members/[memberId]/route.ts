import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  checkTeamAccess,
  checkTeamPermission,
  TeamPermission,
  canChangeRole,
  canRemoveMember,
  TeamRole,
} from '@/lib/team-permissions';

type RouteParams = { params: Promise<{ teamId: string; memberId: string }> };

// PUT /api/teams/[teamId]/members/[memberId] - 更新成员角色
export async function PUT(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId, memberId } = await params;

    // 检查角色更新权限
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.MEMBER_UPDATE_ROLE
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    // 获取操作者的角色
    const access = await checkTeamAccess(session.user.id, teamId);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // 获取目标成员
    const targetMember = await prisma.teamMember.findUnique({
      where: { id: memberId },
    });

    if (!targetMember || targetMember.teamId !== teamId) {
      return NextResponse.json({ error: '成员不存在' }, { status: 404 });
    }

    const { role: newRole } = await req.json();

    // 验证新角色
    const validRoles = ['admin', 'member', 'viewer'];
    if (!newRole || !validRoles.includes(newRole)) {
      return NextResponse.json({ error: '无效的角色' }, { status: 400 });
    }

    // 检查角色变更权限
    const changeCheck = canChangeRole(
      access.role,
      targetMember.role as TeamRole,
      newRole as TeamRole
    );
    if (!changeCheck.allowed) {
      return NextResponse.json({ error: changeCheck.error }, { status: changeCheck.status });
    }

    // 更新角色
    const updatedMember = await prisma.teamMember.update({
      where: { id: memberId },
      data: { role: newRole },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({
      id: updatedMember.id,
      userId: updatedMember.userId,
      role: updatedMember.role,
      user: updatedMember.user,
    });
  } catch (error) {
    console.error('Error updating member role:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// DELETE /api/teams/[teamId]/members/[memberId] - 移除成员
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId, memberId } = await params;

    // 先验证操作者是否为团队成员（防止信息泄露/成员枚举）
    const access = await checkTeamAccess(session.user.id, teamId);
    if (!access.allowed) {
      // 对未授权用户统一返回 404，防止枚举攻击
      return NextResponse.json({ error: '成员不存在' }, { status: 404 });
    }

    // 获取目标成员
    const targetMember = await prisma.teamMember.findUnique({
      where: { id: memberId },
    });

    if (!targetMember || targetMember.teamId !== teamId) {
      return NextResponse.json({ error: '成员不存在' }, { status: 404 });
    }

    const isSelf = targetMember.userId === session.user.id;

    // 如果是移除他人，需要检查移除权限
    if (!isSelf) {
      const permission = await checkTeamPermission(
        session.user.id,
        teamId,
        TeamPermission.MEMBER_REMOVE
      );
      if (!permission.allowed) {
        return NextResponse.json({ error: permission.error }, { status: permission.status });
      }
    }

    // 检查是否可以移除
    const removeCheck = canRemoveMember(access.role, targetMember.role as TeamRole, isSelf);
    if (!removeCheck.allowed) {
      return NextResponse.json({ error: removeCheck.error }, { status: removeCheck.status });
    }

    // 移除成员
    await prisma.teamMember.delete({ where: { id: memberId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing member:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

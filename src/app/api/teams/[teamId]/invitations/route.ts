import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

import { getSession } from '@/lib/auth';
import { db, teams, teamMembers, teamInvitations, users } from '@/lib/prisma';
import { eq, and, gt, desc } from 'drizzle-orm';
import {
  checkTeamAccess,
  checkTeamPermission,
  TeamPermission,
  canInviteWithRole,
  TeamRole,
} from '@/lib/team-permissions';
import { sendTeamInvitationEmail } from '@/lib/resend';

type RouteParams = { params: Promise<{ teamId: string }> };

// 生成邀请令牌
function generateInvitationToken(): string {
  return randomBytes(32).toString('hex');
}

// 获取邀请过期时间（默认7天）
function getInvitationExpiryDate(days: number = 7): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
}

// GET /api/teams/[teamId]/invitations - 列出待处理的邀请
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查查看邀请的权限
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.INVITATION_VIEW
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    // 获取未过期的邀请
    const invitations = await db.query.teamInvitations.findMany({
      where: and(eq(teamInvitations.teamId, teamId), gt(teamInvitations.expiresAt, new Date())),
      orderBy: desc(teamInvitations.createdAt),
    });

    return NextResponse.json({
      invitations: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error listing invitations:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/teams/[teamId]/invitations - 创建邀请
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查创建邀请的权限
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.INVITATION_CREATE
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    // 获取操作者的角色
    const access = await checkTeamAccess(session.user.id, teamId);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { email, role } = await req.json();

    // 验证邮箱
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: '无效的邮箱地址' }, { status: 400 });
    }

    // 验证角色
    const validRoles = ['admin', 'member', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      return NextResponse.json({ error: '无效的角色' }, { status: 400 });
    }

    // 检查邀请角色权限
    const inviteCheck = canInviteWithRole(access.role, role as TeamRole);
    if (!inviteCheck.allowed) {
      return NextResponse.json({ error: inviteCheck.error }, { status: inviteCheck.status });
    }

    // 检查用户是否已是成员（通过 user.email 关联）
    const userWithEmail = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (userWithEmail) {
      const existingMember = await db.query.teamMembers.findFirst({
        where: and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userWithEmail.id)),
      });

      if (existingMember) {
        return NextResponse.json({ error: '此用户已是团队成员' }, { status: 400 });
      }
    }

    // 检查是否已有待处理的邀请
    const existingInvitation = await db.query.teamInvitations.findFirst({
      where: and(
        eq(teamInvitations.teamId, teamId),
        eq(teamInvitations.email, email),
        gt(teamInvitations.expiresAt, new Date())
      ),
    });

    if (existingInvitation) {
      return NextResponse.json({ error: '此邮箱已有待处理的邀请' }, { status: 400 });
    }

    // 获取团队和邀请者信息
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
      columns: { name: true },
    });

    const inviter = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { name: true },
    });

    // 创建邀请
    const token = generateInvitationToken();
    const invitationId = globalThis.crypto.randomUUID();

    const [invitation] = await db
      .insert(teamInvitations)
      .values({
        id: invitationId,
        teamId,
        email,
        role,
        token,
        expiresAt: getInvitationExpiryDate(),
      })
      .returning();

    if (!invitation) {
      throw new Error('Failed to create invitation');
    }

    // 发送邀请邮件
    const emailResult = await sendTeamInvitationEmail(
      email,
      team?.name || '未知团队',
      inviter?.name || '团队成员',
      token
    );

    return NextResponse.json(
      {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        emailSent: emailResult.success,
        // 始终返回邀请链接，便于手动分享或审计
        inviteUrl: emailResult.inviteUrl,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating invitation:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

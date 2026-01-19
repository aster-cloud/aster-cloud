import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, teamInvitations, teamMembers, teams, users } from '@/lib/prisma';
import { eq, and } from 'drizzle-orm';


// POST /api/teams/invitations/accept - 接受邀请
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { token } = await req.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: '无效的邀请令牌' }, { status: 400 });
    }

    // 查找邀请
    const invitation = await db.query.teamInvitations.findFirst({
      where: eq(teamInvitations.token, token),
      with: {
        team: {
          columns: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!invitation) {
      return NextResponse.json({ error: '邀请不存在或已失效' }, { status: 404 });
    }

    // 检查邀请是否过期
    if (invitation.expiresAt < new Date()) {
      // 删除过期邀请
      await db.delete(teamInvitations).where(eq(teamInvitations.id, invitation.id));
      return NextResponse.json({ error: '邀请已过期' }, { status: 400 });
    }

    // 获取当前用户的邮箱
    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { email: true },
    });

    // 检查邀请邮箱是否匹配（安全要求：必须严格匹配）
    if (
      !currentUser?.email ||
      currentUser.email.toLowerCase() !== invitation.email.toLowerCase()
    ) {
      return NextResponse.json({ error: '此邀请仅限指定邮箱使用' }, { status: 403 });
    }

    // 检查用户是否已是成员
    const existingMember = await db.query.teamMembers.findFirst({
      where: and(
        eq(teamMembers.teamId, invitation.teamId),
        eq(teamMembers.userId, session.user.id)
      ),
    });

    if (existingMember) {
      // 删除邀请
      await db.delete(teamInvitations).where(eq(teamInvitations.id, invitation.id));
      return NextResponse.json({ error: '你已是此团队的成员' }, { status: 400 });
    }

    // 使用事务创建成员并删除邀请
    await db.transaction(async (tx) => {
      await tx.insert(teamMembers).values({
        id: globalThis.crypto.randomUUID(),
        teamId: invitation.teamId,
        userId: session.user.id,
        role: invitation.role,
      });

      await tx.delete(teamInvitations).where(eq(teamInvitations.id, invitation.id));
    });

    return NextResponse.json({
      success: true,
      team: {
        id: invitation.team.id,
        name: invitation.team.name,
        slug: invitation.team.slug,
      },
      role: invitation.role,
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

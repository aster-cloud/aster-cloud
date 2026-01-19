import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, teams, teamMembers, policies } from '@/lib/prisma';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { hasFeatureAccess } from '@/lib/usage';
import { validateTeamName, validateSlug } from '@/lib/validation';
import crypto from 'crypto';

// GET /api/teams - 列出用户的团队
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    // 查询用户所属的团队（通过 teamMembers 关联）
    const userTeams = await db.query.teamMembers.findMany({
      where: eq(teamMembers.userId, session.user.id),
      with: {
        team: {
          with: {
            members: {
              where: eq(teamMembers.userId, session.user.id),
            },
          },
        },
      },
      orderBy: desc(teams.updatedAt),
    });

    // 并行获取每个团队的统计信息
    const teamsWithStats = await Promise.all(
      userTeams.map(async (userTeam) => {
        const team = userTeam.team;

        // 获取成员总数
        const [memberCountResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, team.id));

        // 获取策略总数（排除已删除）
        const [policyCountResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(policies)
          .where(and(eq(policies.teamId, team.id), isNull(policies.deletedAt)));

        return {
          id: team.id,
          name: team.name,
          slug: team.slug,
          role: userTeam.role,
          memberCount: memberCountResult.count,
          policyCount: policyCountResult.count,
          createdAt: team.createdAt.toISOString(),
        };
      })
    );

    return NextResponse.json({
      teams: teamsWithStats,
    });
  } catch (error) {
    console.error('Error listing teams:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/teams - 创建新团队
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    // 检查团队功能访问权限
    const hasAccess = await hasFeatureAccess(session.user.id, 'teamFeatures');
    if (!hasAccess) {
      return NextResponse.json(
        { error: '团队功能需要 Team 或 Enterprise 订阅', upgrade: true },
        { status: 403 }
      );
    }

    const { name, slug } = await req.json();

    // 验证名称
    const nameValidation = validateTeamName(name);
    if (!nameValidation.valid) {
      return NextResponse.json({ error: nameValidation.error }, { status: 400 });
    }

    // 验证 slug
    const slugValidation = validateSlug(slug);
    if (!slugValidation.valid) {
      return NextResponse.json({ error: slugValidation.error }, { status: 400 });
    }

    // 检查 slug 唯一性
    const existingTeam = await db.query.teams.findFirst({
      where: eq(teams.slug, slug),
    });
    if (existingTeam) {
      return NextResponse.json({ error: '此 slug 已被使用' }, { status: 400 });
    }

    // 创建团队和所有者成员关系（使用事务）
    const teamId = crypto.randomUUID();
    const memberId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(teams).values({
        id: teamId,
        name,
        slug,
        ownerId: session.user.id,
      });

      await tx.insert(teamMembers).values({
        id: memberId,
        teamId,
        userId: session.user.id,
        role: 'owner',
      });
    });

    // 查询新创建的团队
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
    });

    if (!team) {
      throw new Error('Failed to create team');
    }

    return NextResponse.json(
      {
        id: team.id,
        name: team.name,
        slug: team.slug,
        ownerId: team.ownerId,
        createdAt: team.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating team:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

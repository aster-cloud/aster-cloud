import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasFeatureAccess } from '@/lib/usage';
import { validateTeamName, validateSlug } from '@/lib/validation';

// GET /api/teams - 列出用户的团队
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const teams = await prisma.team.findMany({
      where: {
        members: {
          some: { userId: session.user.id },
        },
      },
      include: {
        members: {
          where: { userId: session.user.id },
          select: { role: true },
        },
        _count: {
          select: { members: true, policies: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        slug: team.slug,
        role: team.members[0]?.role,
        memberCount: team._count.members,
        policyCount: team._count.policies,
        createdAt: team.createdAt.toISOString(),
      })),
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
    const existingTeam = await prisma.team.findUnique({ where: { slug } });
    if (existingTeam) {
      return NextResponse.json({ error: '此 slug 已被使用' }, { status: 400 });
    }

    // 创建团队和所有者成员关系
    const team = await prisma.team.create({
      data: {
        name,
        slug,
        ownerId: session.user.id,
        members: {
          create: {
            userId: session.user.id,
            role: 'owner',
          },
        },
      },
    });

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

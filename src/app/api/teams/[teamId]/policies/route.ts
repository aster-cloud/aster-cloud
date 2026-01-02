import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';

type RouteParams = { params: Promise<{ teamId: string }> };

// GET /api/teams/[teamId]/policies - 列出团队策略
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查查看策略的权限
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.POLICY_VIEW
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    const policies = await prisma.policy.findMany({
      where: { teamId },
      include: {
        _count: {
          select: { executions: true },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      policies: policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        description: policy.description,
        version: policy.version,
        piiFields: policy.piiFields,
        createdBy: policy.user
          ? {
              id: policy.user.id,
              name: policy.user.name,
            }
          : null,
        executionCount: policy._count.executions,
        createdAt: policy.createdAt.toISOString(),
        updatedAt: policy.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error listing team policies:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

// POST /api/teams/[teamId]/policies - 分配策略到团队或创建新策略
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { teamId } = await params;

    // 检查创建策略的权限
    const permission = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.POLICY_CREATE
    );
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status });
    }

    const { policyId, name, content, description } = await req.json();

    // 如果提供了 policyId，将现有策略分配给团队
    if (policyId) {
      // 验证策略存在且属于当前用户
      const existingPolicy = await prisma.policy.findFirst({
        where: {
          id: policyId,
          userId: session.user.id,
          teamId: null, // 只能分配个人策略
        },
      });

      if (!existingPolicy) {
        return NextResponse.json(
          { error: '策略不存在或已分配给其他团队' },
          { status: 404 }
        );
      }

      // 分配策略到团队
      const updatedPolicy = await prisma.policy.update({
        where: { id: policyId },
        data: { teamId },
      });

      return NextResponse.json({
        id: updatedPolicy.id,
        name: updatedPolicy.name,
        teamId: updatedPolicy.teamId,
      });
    }

    // 否则，创建新的团队策略
    if (!name || typeof name !== 'string' || name.length < 1) {
      return NextResponse.json({ error: '策略名称不能为空' }, { status: 400 });
    }

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: '策略内容不能为空' }, { status: 400 });
    }

    const newPolicy = await prisma.policy.create({
      data: {
        name,
        content,
        description: description || null,
        userId: session.user.id,
        teamId,
      },
    });

    return NextResponse.json(
      {
        id: newPolicy.id,
        name: newPolicy.name,
        description: newPolicy.description,
        teamId: newPolicy.teamId,
        createdAt: newPolicy.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating team policy:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

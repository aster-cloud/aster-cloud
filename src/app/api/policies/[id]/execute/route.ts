import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies, executions, teamMembers } from '@/lib/prisma';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { checkUsageLimit, recordUsage } from '@/lib/usage';
import { isPolicyFrozen } from '@/lib/policy-freeze';
import { checkTeamPermission, TeamPermission } from '@/lib/team-permissions';
import { executePolicyUnified, getPrimaryError } from '@/services/policy/cnl-executor';


interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const startTime = Date.now();

  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // 安全解析 JSON body，避免无效 JSON 返回 500
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // 校验 body 是有效对象（非 null、非数组）
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a valid object' }, { status: 400 });
    }

    const { input } = body as { input?: unknown };

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ error: 'Input must be a valid object' }, { status: 400 });
    }

    // 通过验证后，安全地断言类型
    const validatedInput = input as Record<string, unknown>;

    // 先查用户自己的策略或公开策略
    let policy = await db.query.policies.findFirst({
      where: and(
        eq(policies.id, id),
        isNull(policies.deletedAt),
        sql`(${policies.userId} = ${session.user.id} OR ${policies.isPublic} = true)`
      ),
    });

    // 如果不是用户自己的策略,检查是否是团队策略
    if (!policy || (policy.userId !== session.user.id && !policy.isPublic)) {
      const teamPolicy = await db.query.policies.findFirst({
        where: and(
          eq(policies.id, id),
          isNull(policies.deletedAt)
        ),
        with: {
          team: {
            with: {
              members: true,
            },
          },
        },
      });

      if (teamPolicy?.team?.members.some(m => m.userId === session.user.id)) {
        policy = teamPolicy;
      }
    }

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 检查团队策略的执行权限（viewer 角色没有执行权限）
    if (policy.teamId && policy.userId !== session.user.id) {
      const permCheck = await checkTeamPermission(
        session.user.id,
        policy.teamId,
        TeamPermission.POLICY_EXECUTE
      );
      if (!permCheck.allowed) {
        return NextResponse.json({ error: permCheck.error }, { status: permCheck.status });
      }
    }

    // 检查策略是否被冻结（基于策略所有者，而非调用者）
    const freezeInfo = await isPolicyFrozen(policy.userId, id);
    if (freezeInfo.isFrozen) {
      const isOwner = policy.userId === session.user.id;
      return NextResponse.json(
        {
          error: 'Policy is frozen',
          message: isOwner
            ? `This policy is frozen because your plan allows ${freezeInfo.activePoliciesLimit} policies but you have ${freezeInfo.totalPolicies}. Delete some policies or upgrade your plan.`
            : `This policy is frozen because the owner's plan limit has been exceeded. Please contact the policy owner.`,
          frozen: true,
          upgrade: isOwner,
        },
        { status: 403 }
      );
    }

    const limitCheck = await checkUsageLimit(session.user.id, 'execution');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Usage limit exceeded',
          message: limitCheck.message,
          upgrade: true,
        },
        { status: 429 }
      );
    }

    // 使用统一的策略执行服务
    // 租户 ID 使用策略所有者，确保与 API v1 一致
    const executionResult = await executePolicyUnified({
      policy,
      input: validatedInput,
      userId: session.user.id,
      tenantId: policy.teamId || policy.userId,
    });

    const primaryError = getPrimaryError(executionResult);

    const durationMs = Date.now() - startTime;

    const [execution] = await db.insert(executions).values({
      id: globalThis.crypto.randomUUID(),
      userId: session.user.id,
      policyId: id,
      input: validatedInput as object,
      output: executionResult as object,
      error: primaryError,
      durationMs,
      success: executionResult.allowed ?? false,
      source: 'dashboard',
    }).returning();

    await recordUsage(session.user.id, 'execution');

    return NextResponse.json({
      executionId: execution.id,
      success: executionResult.allowed,
      output: executionResult,
      error: primaryError,
      durationMs,
    });
  } catch (error) {
    console.error('Error executing policy:', error);
    // Return detailed error for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      error: 'Internal server error',
      message: errorMessage,
      debug: process.env.NODE_ENV !== 'production' ? String(error) : undefined,
    }, { status: 500 });
  }
}

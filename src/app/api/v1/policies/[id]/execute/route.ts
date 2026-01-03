import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
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
    const auth = await authenticateApiRequest(req);
    if (!auth.success) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { userId, apiKeyId } = auth;
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

    const policy = await prisma.policy.findFirst({
      where: {
        id,
        OR: [
          { userId },
          { isPublic: true },
          {
            team: {
              members: {
                some: { userId },
              },
            },
          },
        ],
      },
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 检查团队策略的执行权限（viewer 角色没有执行权限）
    if (policy.teamId && policy.userId !== userId) {
      const permCheck = await checkTeamPermission(userId, policy.teamId, TeamPermission.POLICY_EXECUTE);
      if (!permCheck.allowed) {
        return NextResponse.json({ error: permCheck.error }, { status: permCheck.status });
      }
    }

    // 检查策略是否被冻结（基于策略所有者，而非调用者）
    const freezeInfo = await isPolicyFrozen(policy.userId, id);
    if (freezeInfo.isFrozen) {
      return NextResponse.json(
        {
          error: 'Policy is frozen',
          message: `This policy is frozen because the owner's plan allows ${freezeInfo.activePoliciesLimit} policies but has ${freezeInfo.totalPolicies}. Please contact the policy owner.`,
          frozen: true,
        },
        { status: 403 }
      );
    }

    // 双重配额校验：API 调用配额 + 执行配额
    const apiLimitCheck = await checkUsageLimit(userId, 'api_call');
    if (!apiLimitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'API call limit exceeded',
          message: apiLimitCheck.message,
        },
        { status: 429 }
      );
    }

    const executionLimitCheck = await checkUsageLimit(userId, 'execution');
    if (!executionLimitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Execution limit exceeded',
          message: executionLimitCheck.message,
        },
        { status: 429 }
      );
    }

    // 使用统一的策略执行服务
    const executionResult = await executePolicyUnified({
      policy,
      input: validatedInput,
      userId,
      tenantId: policy.teamId || policy.userId,
    });

    const primaryError = getPrimaryError(executionResult);
    const durationMs = Date.now() - startTime;

    await prisma.execution.create({
      data: {
        userId,
        policyId: id,
        input: validatedInput as object,
        output: executionResult as object,
        error: primaryError,
        durationMs,
        success: executionResult.allowed,
        source: 'api',
        apiKeyId,
      },
    });

    await recordUsage(userId, 'api_call');
    await recordUsage(userId, 'execution');

    return NextResponse.json({
      success: executionResult.allowed,
      data: executionResult,
      error: primaryError,
      meta: {
        policyId: id,
        policyName: policy.name,
        durationMs,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('API execution error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

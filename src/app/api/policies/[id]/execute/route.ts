import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, recordUsage } from '@/lib/usage';
import { executePolicy } from '@/services/policy/executor';
import { isPolicyFrozen } from '@/lib/policy-freeze';

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
    const { input } = await req.json();

    if (!input || typeof input !== 'object') {
      return NextResponse.json({ error: 'Input must be a valid object' }, { status: 400 });
    }

    const policy = await prisma.policy.findFirst({
      where: {
        id,
        OR: [
          { userId: session.user.id },
          { isPublic: true },
          {
            team: {
              members: {
                some: { userId: session.user.id },
              },
            },
          },
        ],
      },
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 检查策略是否被冻结（只对策略所有者检查）
    if (policy.userId === session.user.id) {
      const freezeInfo = await isPolicyFrozen(session.user.id, id);
      if (freezeInfo.isFrozen) {
        return NextResponse.json(
          {
            error: 'Policy is frozen',
            message: `This policy is frozen because your plan allows ${freezeInfo.activePoliciesLimit} policies but you have ${freezeInfo.totalPolicies}. Delete some policies or upgrade your plan.`,
            frozen: true,
          },
          { status: 403 }
        );
      }
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

    const executionResult = await executePolicy({
      policy,
      input,
      userId: session.user.id,
    });

    const normalizedResult = {
      ...executionResult,
      approved: executionResult.allowed,
    };

    const primaryError = executionResult.deniedReasons[0];
    const durationMs = Date.now() - startTime;

    const execution = await prisma.execution.create({
      data: {
        userId: session.user.id,
        policyId: id,
        input: input as object,
        output: normalizedResult as object,
        error: primaryError,
        durationMs,
        success: executionResult.allowed,
        source: 'dashboard',
      },
    });

    await recordUsage(session.user.id, 'execution');

    return NextResponse.json({
      executionId: execution.id,
      success: executionResult.allowed,
      output: normalizedResult,
      error: primaryError,
      durationMs,
    });
  } catch (error) {
    console.error('Error executing policy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

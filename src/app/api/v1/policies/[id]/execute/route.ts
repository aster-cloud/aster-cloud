import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, recordUsage } from '@/lib/usage';
import { executePolicy } from '@/services/policy/executor';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const startTime = Date.now();

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const apiKey = authHeader.substring(7);
    const validation = await validateApiKey(apiKey);

    if (!validation.valid || !validation.userId) {
      return NextResponse.json({ error: validation.error }, { status: 401 });
    }

    const { id } = await params;
    const { input } = await req.json();

    if (!input || typeof input !== 'object') {
      return NextResponse.json({ error: 'Input must be a valid object' }, { status: 400 });
    }

    const policy = await prisma.policy.findFirst({
      where: {
        id,
        OR: [{ userId: validation.userId }, { isPublic: true }],
      },
    });

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    // 双重配额校验：API 调用配额 + 执行配额
    const apiLimitCheck = await checkUsageLimit(validation.userId, 'api_call');
    if (!apiLimitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'API call limit exceeded',
          message: apiLimitCheck.message,
        },
        { status: 429 }
      );
    }

    const executionLimitCheck = await checkUsageLimit(validation.userId, 'execution');
    if (!executionLimitCheck.allowed) {
      return NextResponse.json(
        {
          error: 'Execution limit exceeded',
          message: executionLimitCheck.message,
        },
        { status: 429 }
      );
    }

    const executionResult = await executePolicy({
      policy,
      input,
      userId: validation.userId,
    });

    const normalizedResult = {
      ...executionResult,
      approved: executionResult.allowed,
    };

    const primaryError = executionResult.deniedReasons[0];
    const durationMs = Date.now() - startTime;

    await prisma.execution.create({
      data: {
        userId: validation.userId,
        policyId: id,
        input: input as object,
        output: normalizedResult as object,
        error: primaryError,
        durationMs,
        success: executionResult.allowed,
        source: 'api',
        apiKeyId: validation.apiKeyId,
      },
    });

    await recordUsage(validation.userId, 'api_call');
    await recordUsage(validation.userId, 'execution');

    return NextResponse.json({
      success: executionResult.allowed,
      data: normalizedResult,
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

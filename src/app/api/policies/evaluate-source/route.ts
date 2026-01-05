import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createPolicyApiClient, PolicyEvaluateResponse } from '@/services/policy/policy-api';

/**
 * POST /api/policies/evaluate-source
 *
 * 直接执行策略源代码，适用于示例策略和即时测试场景
 */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 解析请求体
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a valid object' }, { status: 400 });
    }

    const { source, context, locale, functionName } = body as {
      source?: string;
      context?: Record<string, unknown> | unknown[];
      locale?: string;
      functionName?: string;
    };

    if (!source || typeof source !== 'string') {
      return NextResponse.json({ error: 'Source code is required' }, { status: 400 });
    }

    if (context === undefined || context === null) {
      return NextResponse.json({ error: 'Context is required' }, { status: 400 });
    }

    // 调用 Policy API 执行源代码
    const client = createPolicyApiClient(session.user.id, session.user.id);
    const response: PolicyEvaluateResponse = await client.evaluateSource(source, context, {
      locale: locale || 'en-US',
      functionName,
    });

    if (!response.success) {
      return NextResponse.json(
        {
          success: false,
          error: response.error || 'Evaluation failed',
          executionTimeMs: response.executionTime,
        },
        { status: 400 }
      );
    }

    // 转换响应格式以匹配前端期望
    return NextResponse.json({
      executionId: `exec-${Date.now()}`,
      success: true,
      output: {
        matchedRules: [],
        actions: [],
        approved: Boolean(response.result),
      },
      result: response.result,
      durationMs: response.executionTime || 0,
    });
  } catch (error) {
    console.error('Error evaluating policy source:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

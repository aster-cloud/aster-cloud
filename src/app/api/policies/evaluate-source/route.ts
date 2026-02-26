import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createPolicyApiClient, PolicyEvaluateResponse } from '@/services/policy/policy-api';
import {
  checkRateLimit,
  getClientIp,
  getRateLimitHeaders,
  RateLimitPresets,
} from '@/lib/rate-limit';

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

    // 限流检查：基于用户ID（已认证用户）+ IP 双重标识
    const _ip = getClientIp(req);
    const rateLimitKey = `evaluate-source:${session.user.id}`;
    const result = checkRateLimit(rateLimitKey, RateLimitPresets.EVALUATE_SOURCE);
    const rateLimitHeaders = getRateLimitHeaders(result, RateLimitPresets.EVALUATE_SOURCE);

    if (!result.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          retryAfter: result.retryAfterSeconds,
        },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    // 解析请求体
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: rateLimitHeaders });
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be a valid object' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const { source, context, locale, functionName } = body as {
      source?: string;
      context?: Record<string, unknown> | unknown[];
      locale?: string;
      functionName?: string;
    };

    if (!source || typeof source !== 'string') {
      return NextResponse.json(
        { error: 'Source code is required' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    if (context === undefined || context === null) {
      return NextResponse.json(
        { error: 'Context is required' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // 调用 Policy API 执行源代码
    const client = createPolicyApiClient(session.user.id, session.user.id);
    const response: PolicyEvaluateResponse = await client.evaluateSource(source, context, {
      locale: locale || 'en-US',
      functionName,
    });

    // Policy API 返回 { result, executionTimeMs, error }
    // 使用类型断言获取实际字段
    const apiResponse = response as unknown as {
      result: unknown;
      executionTimeMs: number;
      error: string | null;
    };

    // 如果 error 存在则表示失败
    if (apiResponse.error) {
      return NextResponse.json(
        {
          success: false,
          error: apiResponse.error,
          executionTimeMs: apiResponse.executionTimeMs,
        },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // 转换响应格式以匹配前端期望
    return NextResponse.json(
      {
        executionId: `exec-${Date.now()}`,
        success: true,
        output: {
          matchedRules: [],
          actions: [],
          approved: Boolean(apiResponse.result),
        },
        result: apiResponse.result,
        durationMs: apiResponse.executionTimeMs || 0,
      },
      { headers: rateLimitHeaders }
    );
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

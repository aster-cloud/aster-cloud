import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createPolicyApiClient, PolicySchemaResponse } from '@/services/policy/policy-api';

/**
 * POST /api/policies/schema
 *
 * 获取策略参数模式，用于动态表单生成
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

    const { source, functionName, locale } = body as {
      source?: string;
      functionName?: string;
      locale?: string;
    };

    if (!source || typeof source !== 'string') {
      return NextResponse.json({ error: 'Source code is required' }, { status: 400 });
    }

    // 调用 Policy API 获取参数模式
    const client = createPolicyApiClient(session.user.id, session.user.id);
    const schemaResponse: PolicySchemaResponse = await client.getSchema(source, {
      functionName,
      locale: locale || 'en-US',
    });

    if (!schemaResponse.success) {
      return NextResponse.json(
        {
          success: false,
          error: schemaResponse.error || 'Failed to extract schema',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(schemaResponse);
  } catch (error) {
    console.error('Error getting policy schema:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

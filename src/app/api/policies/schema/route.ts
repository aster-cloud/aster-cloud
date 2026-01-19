import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { PolicyApiClient } from '@/services/policy/policy-api';

/**
 * POST /api/policies/schema
 *
 * 代理请求到远程策略 API 获取策略参数模式
 * 用于动态表单生成
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

    // 使用远程 API 获取 schema
    const client = new PolicyApiClient('default', session.user.id);
    const result = await client.getSchema(source, {
      functionName,
      locale: locale || 'en-US',
    });

    return NextResponse.json(result);
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

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { compileLocally, type CNLLocale } from '@/services/policy/local-compiler';

/**
 * POST /api/policies/schema
 *
 * 获取策略参数模式，用于动态表单生成
 * 使用本地 aster-lang-ts 编译器进行解析，确保与前端一致
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

    // 使用本地编译器提取 schema
    const result = await compileLocally({
      source,
      locale: (locale || 'en-US') as CNLLocale,
      functionName,
      collectSchema: true,
    });

    if (!result.success) {
      // 格式化诊断信息
      const errorMessages = result.diagnostics
        ?.filter((d) => d.severity === 'error')
        .map((d) => `行 ${d.startLine}:${d.startColumn} - ${d.message}`)
        .join('; ');

      return NextResponse.json(
        {
          success: false,
          error: errorMessages
            ? `CNL 语法错误: ${errorMessages}`
            : 'Failed to parse CNL source',
        },
        { status: 400 }
      );
    }

    // 返回 schema 响应（扁平化结构以匹配前端 PolicySchema 接口）
    return NextResponse.json({
      success: true,
      functionName: result.schema?.functionName,
      parameters: result.schema?.parameters,
      moduleName: result.moduleName,
      functionNames: result.functionNames,
    });
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

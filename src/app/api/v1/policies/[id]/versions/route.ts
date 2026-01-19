/**
 * 版本列表 API 端点
 *
 * GET  - 获取策略的所有版本
 * POST - 创建新版本
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

import {
  createVersion,
  listVersions,
  listExecutableVersions,
} from '@/services/policy/version-manager';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/policies/{id}/versions
 *
 * 获取策略的所有版本列表
 * 支持 ?executable=true 参数只返回可执行版本
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;
    const executableOnly =
      request.nextUrl.searchParams.get('executable') === 'true';

    const versions = executableOnly
      ? await listExecutableVersions(id)
      : await listVersions(id);

    return NextResponse.json({ versions });
  } catch (error) {
    console.error('[Versions GET] Error:', error);
    return NextResponse.json(
      { error: '获取版本列表失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/policies/{id}/versions
 *
 * 创建新版本
 * Body: { source: string, releaseNote?: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: '无效的 JSON 请求体' },
        { status: 400 }
      );
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: '请求体必须是有效对象' },
        { status: 400 }
      );
    }

    const { source, releaseNote } = body as {
      source?: string;
      releaseNote?: string;
    };

    if (!source || typeof source !== 'string') {
      return NextResponse.json(
        { error: '缺少 source 字段' },
        { status: 400 }
      );
    }

    const result = await createVersion({
      policyId: id,
      source,
      createdBy: session.user.id,
      releaseNote,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('[Versions POST] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建版本失败' },
      { status: 500 }
    );
  }
}

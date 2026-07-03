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
import {
  getStructuralAliasGrant,
  buildAliasReservedForUser,
} from '@/lib/structural-alias-grants';

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

    const { source, releaseNote, aliasSet, locale } = body as {
      source?: string;
      releaseNote?: string;
      aliasSet?: unknown;
      locale?: unknown;
    };

    if (!source || typeof source !== 'string') {
      return NextResponse.json(
        { error: '缺少 source 字段' },
        { status: 400 }
      );
    }

    // 关键词别名（ADR 0022）：此入口同样走 version-manager 的可信路径——校验 + canonical +
    // envelope 冻结 + 审计。绝不静默忽略 aliasSet（此前忽略 → 别名策略在此入口丢别名）。
    // allowStructural 从服务端 per-user entitlement 权威取（不信 body）；aliasReserved server 组装。
    const aliasSetInput =
      aliasSet &&
      typeof aliasSet === 'object' &&
      !Array.isArray(aliasSet) &&
      Object.keys(aliasSet as Record<string, unknown>).length > 0
        ? (aliasSet as Record<string, string[]>)
        : null;
    const compileLocale =
      typeof locale === 'string' && locale.trim() ? locale : 'en-US';
    const allowStructural = aliasSetInput
      ? await getStructuralAliasGrant(session.user.id)
      : false;
    const aliasReserved = aliasSetInput
      ? await buildAliasReservedForUser(session.user.id, compileLocale)
      : undefined;

    const result = await createVersion({
      policyId: id,
      source,
      createdBy: session.user.id,
      releaseNote,
      locale: compileLocale,
      aliasSet: aliasSetInput,
      aliasReserved,
      allowStructuralAliases: allowStructural,
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

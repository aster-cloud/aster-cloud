/**
 * 废弃版本 API 端点
 *
 * POST /api/v1/policies/{id}/versions/{version}/deprecate
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

import { deprecateVersion } from '@/services/policy/version-manager';

interface RouteParams {
  params: Promise<{ id: string; version: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const { id, version: versionStr } = await params;
    const version = parseInt(versionStr, 10);

    if (isNaN(version)) {
      return NextResponse.json({ error: '无效的版本号' }, { status: 400 });
    }

    // 解析可选的 reason 字段
    let reason: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body === 'object' && typeof body.reason === 'string') {
        reason = body.reason;
      }
    } catch {
      // 忽略 JSON 解析错误，reason 为可选
    }

    await deprecateVersion({
      policyId: id,
      version,
      userId: session.user.id,
      reason,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Deprecate] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '废弃版本失败' },
      { status: 400 }
    );
  }
}

/**
 * 设置默认版本 API 端点
 *
 * POST /api/v1/policies/{id}/versions/{version}/set-default
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

import { setDefaultVersion } from '@/services/policy/version-manager';

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

    await setDefaultVersion({
      policyId: id,
      version,
      userId: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[SetDefault] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '设置默认版本失败' },
      { status: 400 }
    );
  }
}

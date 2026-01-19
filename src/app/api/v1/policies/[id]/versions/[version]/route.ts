/**
 * 版本详情 API
 *
 * GET /api/v1/policies/{id}/versions/{version}
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

import { getVersionDetail } from '@/services/policy/version-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const { id: policyId, version: versionStr } = await params;
  const version = parseInt(versionStr, 10);
  if (isNaN(version)) {
    return NextResponse.json({ error: '无效的版本号' }, { status: 400 });
  }

  try {
    const detail = await getVersionDetail({ policyId, version });

    if (!detail) {
      return NextResponse.json({ error: '版本不存在' }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取版本详情失败' },
      { status: 500 }
    );
  }
}

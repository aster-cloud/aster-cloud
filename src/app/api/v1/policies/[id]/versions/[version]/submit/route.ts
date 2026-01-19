/**
 * 提交版本审批 API
 *
 * POST /api/v1/policies/{id}/versions/{version}/submit
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

import { submitForApproval } from '@/services/policy/version-manager';

export async function POST(
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
    await submitForApproval({
      policyId,
      version,
      userId: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '提交审批失败' },
      { status: 400 }
    );
  }
}

/**
 * 批准版本 API
 *
 * POST /api/v1/policies/{id}/versions/{version}/approve
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

import { approveVersion } from '@/services/policy/version-manager';

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

  let body: { comment?: string } = {};
  try {
    body = await request.json();
  } catch {
    // 允许空 body
  }

  try {
    await approveVersion({
      policyId,
      version,
      approverId: session.user.id,
      decision: 'APPROVED',
      comment: body.comment,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '批准失败' },
      { status: 400 }
    );
  }
}

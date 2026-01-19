/**
 * 安全事件统计 API
 *
 * GET /api/v1/security/stats - 获取安全事件统计信息
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

import { getSecurityEventStats } from '@/services/security/security-event-service';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // 解析查询参数
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const policyId = searchParams.get('policyId');

  // 默认查询最近 24 小时
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate
    ? new Date(startDate)
    : new Date(end.getTime() - 24 * 60 * 60 * 1000);

  try {
    const stats = await getSecurityEventStats({
      startDate: start,
      endDate: end,
      policyId: policyId ?? undefined,
    });

    return NextResponse.json({
      ...stats,
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Security Stats API] Query failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取安全统计失败' },
      { status: 500 }
    );
  }
}

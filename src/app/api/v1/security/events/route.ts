/**
 * 安全事件查询 API
 *
 * GET /api/v1/security/events - 查询安全事件列表
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSecurityEvents } from '@/services/security/security-event-service';
import type { SecurityEventType, EventSeverity } from '@prisma/client';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // 解析查询参数
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const eventTypes = searchParams.get('eventTypes');
  const severities = searchParams.get('severities');
  const policyId = searchParams.get('policyId');
  const limit = searchParams.get('limit');
  const offset = searchParams.get('offset');

  try {
    const { events, total } = await getSecurityEvents({
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      eventTypes: eventTypes
        ? (eventTypes.split(',') as SecurityEventType[])
        : undefined,
      severities: severities
        ? (severities.split(',') as EventSeverity[])
        : undefined,
      policyId: policyId ?? undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    return NextResponse.json({
      events,
      total,
      page: offset ? Math.floor(parseInt(offset, 10) / (limit ? parseInt(limit, 10) : 50)) : 0,
      pageSize: limit ? parseInt(limit, 10) : 50,
    });
  } catch (error) {
    console.error('[Security Events API] Query failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '查询安全事件失败' },
      { status: 500 }
    );
  }
}

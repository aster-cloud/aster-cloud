/**
 * Policy Execution API 配额查询 + 记录
 *
 * GET ?userId=xxx&periodMonth=YYYY-MM   → 当月已用次数
 * POST { userId, tenantId, endpointPath, status, latencyMs }  → 记录一次调用
 *
 * 由 aster-api PolicyEvaluationResource 调用（HMAC 验签）。
 */
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { db, apiCallRecords } from '@/lib/prisma';
import { and, eq, sql } from 'drizzle-orm';

function verifyHmac(req: Request, method: string): NextResponse | null {
  const sharedKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  if (!sharedKey) return null; // dev/test 跳过
  const timestamp = req.headers.get('X-Aster-Timestamp');
  const signature = req.headers.get('X-Aster-Signature');
  if (!timestamp || !signature) {
    return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 });
  }
  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return NextResponse.json({ error: 'Stale timestamp' }, { status: 401 });
  }
  const url = new URL(req.url);
  const expected = createHmac('sha256', sharedKey)
    .update(`${method}\n${url.pathname}\n${timestamp}`)
    .digest('hex');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const err = verifyHmac(req, 'GET');
  if (err) return err;

  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  const periodMonth = url.searchParams.get('periodMonth') ?? currentPeriod();
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(apiCallRecords)
    .where(
      and(
        eq(apiCallRecords.userId, userId),
        eq(apiCallRecords.periodMonth, periodMonth),
        eq(apiCallRecords.status, 'success')
      )
    );

  return NextResponse.json({
    userId,
    periodMonth,
    used: r[0]?.c ?? 0,
  });
}

export async function POST(req: Request) {
  const err = verifyHmac(req, 'POST');
  if (err) return err;

  const body = (await req.json()) as {
    userId: string;
    tenantId?: string;
    apiKeyId?: string;
    endpointPath: string;
    status: 'success' | 'quota_exhausted' | 'rate_limited' | 'api_error';
    latencyMs?: number;
  };

  if (!body.userId || !body.endpointPath || !body.status) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  await db.insert(apiCallRecords).values({
    id: randomUUID(),
    userId: body.userId,
    tenantId: body.tenantId ?? null,
    apiKeyId: body.apiKeyId ?? null,
    periodMonth: currentPeriod(),
    endpointPath: body.endpointPath,
    status: body.status,
    latencyMs: body.latencyMs ?? 0,
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true });
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

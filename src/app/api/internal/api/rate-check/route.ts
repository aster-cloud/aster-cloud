/**
 * Per-API-key per-second 限流检查（HMAC 内部接口）
 *
 * POST { apiKeyId, plan }  → { allowed, used, limit, retryAfterSec? }
 *
 * 由 aster-api PolicyEvaluationResource 同步调用（< 5ms）；
 * Redis 不可达时 fail-open。
 */
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { checkRate } from '@/lib/api-rate-limiter';
import type { PlanType } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sharedKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  if (sharedKey) {
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
      .update(`POST\n${url.pathname}\n${timestamp}`)
      .digest('hex');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  const body = (await req.json()) as { apiKeyId?: string; plan?: PlanType };
  if (!body.apiKeyId || !body.plan) {
    return NextResponse.json({ error: 'Missing apiKeyId or plan' }, { status: 400 });
  }

  const result = await checkRate(body.apiKeyId, body.plan);
  return NextResponse.json(result);
}

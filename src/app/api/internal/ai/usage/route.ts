import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { recordAiUsage } from '@/lib/ai-quota';

/**
 * 内部接口：aster-api 调用 LLM 完成后记录实际 token 用量
 *
 * POST /api/internal/ai/usage
 */
export async function POST(req: Request) {
  const sharedKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  // Fail-closed: without the shared HMAC key we cannot authenticate the
  // caller, so refuse to serve rather than leak data (audit #168).
  if (!sharedKey) {
    return NextResponse.json({ error: 'Internal verification unavailable' }, { status: 503 });
  }
  {
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

  const body = (await req.json()) as Parameters<typeof recordAiUsage>[0];
  await recordAiUsage(body);
  return NextResponse.json({ ok: true });
}

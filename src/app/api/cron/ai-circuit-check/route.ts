/**
 * 全局成本熔断器 cron（每 10 分钟扫一次）
 */
import { NextRequest, NextResponse } from 'next/server';
import { todayPlatformCostCents, evaluateCircuit, applyCircuit } from '@/lib/ai-circuit-breaker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cents = await todayPlatformCostCents();
  const state = evaluateCircuit(cents);
  const result = await applyCircuit(state);

  console.log(`[ai-circuit] today=$${(cents / 100).toFixed(2)} state=${state} banned=${result.affected}`);

  return NextResponse.json({
    today_cents: cents,
    today_usd: (cents / 100).toFixed(2),
    state,
    affected: result.affected,
  });
}

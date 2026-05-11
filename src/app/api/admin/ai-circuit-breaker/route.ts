/**
 * 管理员手动控制 AI 熔断器
 *
 * POST { action: "release" }  → 立即解除全局熔断
 * GET                          → 查看当前状态
 *
 * 仅 plan=enterprise OR role=admin 用户可访问
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, users } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import {
  todayPlatformCostCents,
  evaluateCircuit,
  releaseCircuit,
  CIRCUIT_BREAKER_THRESHOLDS,
} from '@/lib/ai-circuit-breaker';

async function ensureAdmin(): Promise<{ userId: string } | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { plan: true },
  });
  if (!user || user.plan !== 'enterprise') {
    // 简化版：仅 enterprise 用户视为 admin（生产应有专门 role 字段）
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { userId: session.user.id };
}

export async function GET() {
  const check = await ensureAdmin();
  if (check instanceof NextResponse) return check;

  const cents = await todayPlatformCostCents();
  const state = evaluateCircuit(cents);

  return NextResponse.json({
    today_cents: cents,
    today_usd: (cents / 100).toFixed(2),
    state,
    thresholds: {
      free_stop_usd: CIRCUIT_BREAKER_THRESHOLDS.freeStop / 100,
      trial_stop_usd: CIRCUIT_BREAKER_THRESHOLDS.trialStop / 100,
    },
  });
}

export async function POST(req: Request) {
  const check = await ensureAdmin();
  if (check instanceof NextResponse) return check;

  const body = (await req.json()) as { action: string };
  if (body.action === 'release') {
    const result = await releaseCircuit();
    console.warn(`[ai-circuit] manual release by ${check.userId}, released ${result.released} users`);
    return NextResponse.json({ ok: true, released: result.released });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

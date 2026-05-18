/**
 * 管理员手动控制 AI 熔断器
 *
 * POST { action: "release" }  → 立即解除全局熔断
 * GET                          → 查看当前状态
 *
 * 仅 User.isAdmin=true 用户可访问（与套餐 plan 解耦，见 lib/admin-auth.ts）
 */
import { NextResponse } from 'next/server';
import {
  todayPlatformCostCents,
  evaluateCircuit,
  releaseCircuit,
  CIRCUIT_BREAKER_THRESHOLDS,
} from '@/lib/ai-circuit-breaker';
import { requireAdmin } from '@/lib/admin-auth';
import { requireLicenseWriteOk } from '@/lib/license-write-gate';

const ensureAdmin = requireAdmin;

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

  // On-prem read-only mode（grace-expired / revoked / expired / malformed / missing）
  // 禁止 admin mutate；release circuit 是 mutate 操作。SaaS 永远 noop。
  const writeGate = await requireLicenseWriteOk();
  if (writeGate) return writeGate;

  const body = (await req.json()) as { action: string };
  if (body.action === 'release') {
    const result = await releaseCircuit();
    console.warn(`[ai-circuit] manual release by ${check.userId}, released ${result.released} users`);
    return NextResponse.json({ ok: true, released: result.released });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

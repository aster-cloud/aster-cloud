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
import { errorEnvelope } from '@/lib/api/error-envelope';

const ensureAdmin = requireAdmin;

export async function GET() {
  // Try/catch wrap so any throw from auth() / todayPlatformCostCents()
  // / evaluateCircuit() returns a JSON 503 envelope rather than Next's
  // default HTML 500 page. The admin UI now has an error boundary, but
  // we still want the response to be machine-parseable for client
  // retry. See admin-UI audit punch list P0-5.
  try {
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
  } catch (err) {
    const env = errorEnvelope({
      status: 503,
      code: 'service_unavailable',
      message: 'AI circuit state is currently unavailable. Please retry.',
    });
    console.error(
      '[ai-circuit-breaker GET] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

export async function POST(req: Request) {
  // On-prem read-only mode（grace-expired / revoked / expired / malformed / missing）
  // 禁止 admin mutate；release circuit 是 mutate 操作。SaaS 永远 noop。
  // Stays at top-level (not inside try/catch) to satisfy the
  // deployment-mode/require-license-write-gate lint rule.
  const writeGate = await requireLicenseWriteOk();
  if (writeGate) return writeGate;

  try {
    const check = await ensureAdmin();
    if (check instanceof NextResponse) return check;

    const body = (await req.json()) as { action: string };
    if (body.action === 'release') {
      const result = await releaseCircuit();
      console.warn(`[ai-circuit] manual release by ${check.userId}, released ${result.released} users`);
      return NextResponse.json({ ok: true, released: result.released });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const env = errorEnvelope({
      status: 503,
      code: 'service_unavailable',
      message: 'AI circuit release failed. Please retry; the failure has been logged.',
    });
    console.error(
      '[ai-circuit-breaker POST] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

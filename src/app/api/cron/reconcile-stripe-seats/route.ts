/**
 * GET/POST /api/cron/reconcile-stripe-seats
 *
 * Daily Stripe seat reconciliation cron. See lib/stripe-reconcile.ts for details.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}` header.
 *
 * Query / body params:
 *   - dryRun (boolean): override env var; reports planned changes without applying
 */

import { NextRequest, NextResponse } from 'next/server';
import { reconcileStripeSeats } from '@/lib/stripe-reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorize(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // dev mode
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === 'true';

  try {
    const report = await reconcileStripeSeats({ dryRun });
    if (report.haltedByAggregateLimit) {
      console.error('[cron-reconcile] halted by aggregate threshold', report);
    }
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...report,
    });
  } catch (err) {
    console.error('[cron-reconcile] error', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  // POST 与 GET 等价；保留以兼容某些 cron 平台仅支持 POST 的场景
  return GET(request);
}

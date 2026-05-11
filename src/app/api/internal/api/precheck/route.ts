/**
 * 一次 RTT 完成 plan + usage + ban 检查（合并 AKA-8）
 *
 * 替代之前的两次调用：
 *   1. /api/internal/tenant/{userId}/plan
 *   2. /api/internal/api/usage?userId=...
 *
 * 返回 aster-api ApiQuotaGuard.check() 需要的所有字段。
 */
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, users, apiCallRecords } from '@/lib/prisma';
import { eq, and, sql } from 'drizzle-orm';
import { getEffectiveLimits, type PlanType } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
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
      .update(`GET\n${url.pathname}\n${timestamp}`)
      .digest('hex');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      plan: true,
      priceLockedAt: true,
      legacyTier: true,
      subscriptionStatus: true,
      gracePeriodEndsAt: true,
      aiBannedUntil: true,
    },
  });
  if (!user) {
    // 未知用户：plan-gate fail-open 默认按 free 处理
    return NextResponse.json({
      plan: 'free',
      apiCallsLimit: 0,
      monthlyUsed: 0,
      banned: false,
    });
  }

  const limits = getEffectiveLimits({
    plan: user.plan as PlanType,
    priceLockedAt: user.priceLockedAt,
    legacyTier: user.legacyTier,
  });

  const period = currentPeriod();
  const used = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(apiCallRecords)
    .where(
      and(
        eq(apiCallRecords.userId, userId),
        eq(apiCallRecords.periodMonth, period),
        eq(apiCallRecords.status, 'success')
      )
    );

  return NextResponse.json({
    plan: user.plan,
    legacyTier: user.legacyTier ?? null,
    subscriptionStatus: user.subscriptionStatus ?? null,
    apiCallsLimit: limits.apiCalls,
    monthlyUsed: used[0]?.c ?? 0,
    period,
    banned: !!user.aiBannedUntil && user.aiBannedUntil > new Date(),
    gracePeriodEndsAt: user.gracePeriodEndsAt?.toISOString() ?? null,
  });
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

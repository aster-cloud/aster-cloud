// 用户 Policy Execution API 用量查询（dashboard 卡片用）
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, users, apiCallRecords } from '@/lib/prisma';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getEffectiveLimits, type PlanType } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { plan: true, priceLockedAt: true, legacyTier: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const limits = getEffectiveLimits({
    plan: user.plan as PlanType,
    priceLockedAt: user.priceLockedAt,
    legacyTier: user.legacyTier,
  });
  const limit = limits.apiCalls;
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
  const usedCount = used[0]?.c ?? 0;

  // p50 / p95 latency（最近 7 天 success）
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const latencyResult = await db.execute(sql`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs")::int AS p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::int AS p95,
      count(*)::int AS sample_count
    FROM "ApiCallRecord"
    WHERE "userId" = ${userId}
      AND "createdAt" >= ${sevenDaysAgo.toISOString()}::timestamp
      AND status = 'success'
  `);
  const latRow = (latencyResult as unknown as Array<{
    p50: number | null;
    p95: number | null;
    sample_count: number;
  }>)[0] ?? { p50: 0, p95: 0, sample_count: 0 };

  // 最近 7 天日趋势
  const trendResult = await db.execute(sql`
    SELECT
      date_trunc('day', "createdAt")::date::text AS day,
      count(*)::int AS calls
    FROM "ApiCallRecord"
    WHERE "userId" = ${userId}
      AND "createdAt" >= ${sevenDaysAgo.toISOString()}::timestamp
      AND status = 'success'
    GROUP BY 1
    ORDER BY 1
  `);
  const trend = (trendResult as unknown as Array<{ day: string; calls: number }>);
  void gte;

  return NextResponse.json({
    plan: user.plan,
    period,
    monthly: {
      used: usedCount,
      limit,
      remaining: limit === -1 ? -1 : Math.max(0, limit - usedCount),
      percent: limit === -1 ? 0 : Math.min(999, Math.round((usedCount / Math.max(limit, 1)) * 100)),
    },
    latency: {
      p50: latRow.p50 ?? 0,
      p95: latRow.p95 ?? 0,
      sampleCount: latRow.sample_count,
    },
    trend,
  });
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

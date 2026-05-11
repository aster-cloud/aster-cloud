// 用户 AI 用量查询（dashboard 进度条用）
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, users, aiUsageRecords, aiKeyBindings } from '@/lib/prisma';
import { eq, and, sum, sql, gte } from 'drizzle-orm';
import { AI_MONTHLY_QUOTA, AI_RATE_LIMIT_PER_MINUTE } from '@/lib/ai-quota';
import type { PlanType } from '@/lib/plans';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { plan: true, aiBannedUntil: true, aiBanReason: true, emailVerified: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const plan = user.plan as PlanType;
  const period = currentPeriod();

  // 当月已用次数（仅 平台 LLM，不含 BYOK）
  const monthlyUsed = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(aiUsageRecords)
    .where(
      and(
        eq(aiUsageRecords.userId, userId),
        eq(aiUsageRecords.periodMonth, period),
        eq(aiUsageRecords.usedByok, false),
        eq(aiUsageRecords.status, 'success')
      )
    );

  // 当月总成本（含 BYOK，给用户看真实消耗）
  const monthlyCost = await db
    .select({
      cents: sql<number>`coalesce(sum("costCents"), 0)::int`,
      tokens: sql<number>`coalesce(sum("promptTokens" + "completionTokens"), 0)::int`,
    })
    .from(aiUsageRecords)
    .where(and(eq(aiUsageRecords.userId, userId), eq(aiUsageRecords.periodMonth, period)));

  // BYOK 状态
  const byokKeys = await db.query.aiKeyBindings.findMany({
    where: and(eq(aiKeyBindings.userId, userId), eq(aiKeyBindings.active, true)),
    columns: { provider: true, keyHint: true, lastUsedAt: true },
  });

  // 最近 1 分钟调用（用于显示限流警告）
  const lastMinute = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(aiUsageRecords)
    .where(
      and(
        eq(aiUsageRecords.userId, userId),
        gte(aiUsageRecords.createdAt, new Date(Date.now() - 60_000))
      )
    );

  const monthlyLimit = AI_MONTHLY_QUOTA[plan as keyof typeof AI_MONTHLY_QUOTA] ?? 20;
  const perMinuteLimit = AI_RATE_LIMIT_PER_MINUTE[plan as keyof typeof AI_RATE_LIMIT_PER_MINUTE] ?? 5;
  const used = monthlyUsed[0]?.c ?? 0;

  return NextResponse.json({
    plan,
    period,
    monthly: {
      used,
      limit: monthlyLimit,
      remaining: monthlyLimit === -1 ? -1 : Math.max(0, monthlyLimit - used),
      percent: monthlyLimit === -1 ? 0 : Math.round((used / monthlyLimit) * 100),
    },
    cost: {
      cents: monthlyCost[0]?.cents ?? 0,
      tokens: monthlyCost[0]?.tokens ?? 0,
    },
    rateLimit: {
      perMinute: perMinuteLimit,
      perMinuteUsed: lastMinute[0]?.c ?? 0,
    },
    byok: {
      enabled: byokKeys.length > 0,
      providers: byokKeys.map((k) => ({
        provider: k.provider,
        keyHint: k.keyHint,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      })),
    },
    banned: user.aiBannedUntil && user.aiBannedUntil > new Date()
      ? { until: user.aiBannedUntil.toISOString(), reason: user.aiBanReason }
      : null,
    emailVerified: !!user.emailVerified,
  });
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

void sum; // 保留 import

/**
 * 风险等级自动复评 cron（建议每天 05:00 UTC）
 *
 * 找出 riskTier ≥ 2 且最近 7 天无任何风险事件的用户，tier -1。
 * 让风控不"一日重判终身"——配合 admin 手动 override 做双向流动。
 *
 * "风险事件"定义（任一命中即跳过本次降级）：
 *   - aiBannedUntil 在最近 7d 内（被自动封过 AI）
 *   - audit log 里 7d 内有 user.purge_attempt / user.signup_burst /
 *     user.ai_anomaly_block 等风控类事件（detectAndBan 写的）
 *   - 仍处于墓碑（deletedAt 非空）— 软删用户不参与复评
 *
 * 单次降一级，不一次降到 0。给真实改善留迭代空间。
 *
 * 触发：Cloudflare Cron Trigger 调用此路由 + Authorization: Bearer ${CRON_SECRET}
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { users, auditLogs } from '@/db/schema';
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUIET_WINDOW_DAYS = 7;
const RISK_AUDIT_ACTIONS = [
  'user.purge_attempt',
  'user.signup_burst',
  'user.ai_anomaly_block',
  'user.risk_tier_overridden', // 不要在 admin 刚 override 完就立刻 decay
];

interface DecayResult {
  userId: string;
  previousTier: number;
  newTier: number;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - QUIET_WINDOW_DAYS * 86400_000);

  // 1) 候选集：tier ≥ 2，非软删
  const candidates = await db.query.users.findMany({
    where: and(gte(users.riskTier, 2), isNull(users.deletedAt)),
    columns: {
      id: true,
      riskTier: true,
      riskTierReason: true,
      aiBannedUntil: true,
      updatedAt: true,
    },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ decayed: 0, results: [] });
  }

  const candidateIds = candidates.map((c) => c.id);

  // 2) 用一次 IN 查询拿到所有"有风险事件"的 userId 集合
  const noisyRows = await db
    .select({ userId: auditLogs.userId })
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.userId, candidateIds),
        inArray(auditLogs.action, RISK_AUDIT_ACTIONS),
        gte(auditLogs.createdAt, windowStart),
      ),
    )
    .groupBy(auditLogs.userId);

  const noisy = new Set(noisyRows.map((r) => r.userId).filter((id): id is string => id !== null));

  // 3) 决策 + 写入
  const results: DecayResult[] = [];
  for (const c of candidates) {
    if (noisy.has(c.id)) continue;
    if (c.aiBannedUntil && c.aiBannedUntil > windowStart) continue;
    // tier 在 7d 内被改过（manual override 或上次 decay）→ 跳过，等下一轮
    if (c.updatedAt > windowStart) continue;

    const previousTier = c.riskTier;
    const newTier = previousTier - 1;
    const newReason = `auto_decay:was=${previousTier}:after=${QUIET_WINDOW_DAYS}d_quiet:was_reason=${c.riskTierReason ?? 'unknown'}`;

    try {
      await db.update(users)
        .set({
          riskTier: newTier,
          riskTierReason: newReason,
          updatedAt: now,
        })
        .where(eq(users.id, c.id));

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        userId: c.id,
        action: 'user.risk_tier_decayed',
        resource: 'user',
        resourceId: c.id,
        metadata: {
          previousTier,
          newTier,
          previousReason: c.riskTierReason,
          quietWindowDays: QUIET_WINDOW_DAYS,
        },
        createdAt: now,
      });

      results.push({ userId: c.id, previousTier, newTier });
    } catch (e) {
      console.error(`[risk-tier-decay] failed for ${c.id}:`, e);
    }
  }

  console.log(
    `[risk-tier-decay] candidates=${candidates.length} noisy=${noisy.size} decayed=${results.length}`,
  );

  return NextResponse.json({
    decayed: results.length,
    candidates: candidates.length,
    quietWindowDays: QUIET_WINDOW_DAYS,
    results,
  });
}

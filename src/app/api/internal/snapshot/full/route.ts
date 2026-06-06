/**
 * 全量 snapshot 拉取（aster-api warm-up + 1h 对账 cron 调用）
 *
 * GET ?cursor=<userId>&limit=1000
 *   → { users: [...], apiKeys: [...], nextCursor: <userId> | null }
 *
 * users 与 apiKeys 一并返回（按 userId 排序，cursor 是上一页最后一个 userId）。
 */
import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, users, apiKeys } from '@/lib/prisma';
import { gt, asc, and, inArray, isNull } from 'drizzle-orm';
import { getEffectiveLimits, type PlanType } from '@/lib/plans';
import { SOLO_TENANT_ROLE } from '@/lib/team-permissions';

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
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '1000', 10), 5000);

  const userRows = await db.query.users.findMany({
    where: cursor ? gt(users.id, cursor) : undefined,
    orderBy: asc(users.id),
    limit,
    columns: {
      id: true,
      plan: true,
      priceLockedAt: true,
      legacyTier: true,
      subscriptionStatus: true,
      aiBannedUntil: true,
      gracePeriodEndsAt: true,
    },
  });

  const userSnapshots = userRows.map((u) => {
    const lim = getEffectiveLimits({
      plan: u.plan as PlanType,
      priceLockedAt: u.priceLockedAt,
      legacyTier: u.legacyTier,
    });
    return {
      userId: u.id,
      plan: u.plan,
      apiCallsLimit: lim.apiCalls,
      subscriptionStatus: u.subscriptionStatus ?? null,
      aiBannedUntilEpochMs: u.aiBannedUntil?.getTime() ?? null,
      gracePeriodEndsEpochMs: u.gracePeriodEndsAt?.getTime() ?? null,
    };
  });

  // 同窗口内的所有 active apiKeys（仅 valid + 未撤销）
  const userIds = userRows.map((u) => u.id);
  let keyRows: Array<{ id: string; userId: string; key: string; revokedAt: Date | null; expiresAt: Date | null }> = [];
  if (userIds.length > 0) {
    // 把 userId 过滤下推到 SQL（inArray + ApiKey_userId_idx），而不是全表
    // 拉 active keys 再在内存里 filter——后者随 key 总量线性膨胀、与 limit
    // 无关，warmup 内存/延迟会随规模失控。
    keyRows = await db.query.apiKeys.findMany({
      where: and(isNull(apiKeys.revokedAt), inArray(apiKeys.userId, userIds)),
      columns: { id: true, userId: true, key: true, revokedAt: true, expiresAt: true },
    });
  }

  // 按 userId 关联 plan，回填到 apikey snapshot
  const userPlanMap = new Map(userRows.map((u) => [u.id, u.plan]));
  const apiKeySnapshots = keyRows.map((k) => ({
    keyHash: k.key,
    valid: !k.expiresAt || k.expiresAt.getTime() >= Date.now(),
    apiKeyId: k.id,
    userId: k.userId,
    // tenantId 与 /api/internal/apikey/verify 同源（当前 tenantId === userId）。
    // 显式下发让 aster-api 的 snapshot 命中路径拿到权威租户而非回退猜测；
    // 未来引入多租户 team 时改为 k.tenantId 即可。
    tenantId: k.userId,
    // RBAC 角色，与 verify route 同源（tenantId===userId → owner）。
    role: SOLO_TENANT_ROLE,
    plan: userPlanMap.get(k.userId) ?? 'free',
    revokedAtEpochMs: k.revokedAt?.getTime() ?? null,
  }));

  const nextCursor = userRows.length === limit ? userRows[userRows.length - 1].id : null;

  return NextResponse.json({
    users: userSnapshots,
    apiKeys: apiKeySnapshots,
    nextCursor,
  });
}

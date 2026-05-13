/**
 * 用户硬清理 cron（每天 04:00 UTC，建议）
 *
 * 找出 purgePendingUntil < now 的所有墓碑用户（已过 30 天 grace），
 * 执行物理删除。删除前把"该归一邮箱被清理"事件写到 audit log，
 * 让未来同邮箱新注册可以查到 priorPurgeCount，做反复活滥用判断。
 *
 * 触发：Cloudflare Cron Trigger 或 Vercel cron，调用此路由并带
 *   Authorization: Bearer ${CRON_SECRET}
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, users, auditLogs } from '@/lib/prisma';
import { and, eq, isNotNull, lt } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PurgeResult {
  userId: string;
  emailNormalizedHistorical: string | null;
  tombstonedAt: string;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  const expired = await db.query.users.findMany({
    where: and(
      isNotNull(users.deletedAt),
      isNotNull(users.purgePendingUntil),
      lt(users.purgePendingUntil, now),
    ),
    columns: {
      id: true,
      email: true,
      emailNormalized: true,
      deletedAt: true,
    },
  });

  const results: PurgeResult[] = [];

  for (const u of expired) {
    // emailNormalized 在 softDeleteUser 时已变成 "{原值}#deleted-{ts}"，
    // 从中剥出原值用于 audit log 写入。
    const historicalNormalized = u.emailNormalized?.split('#deleted-')[0] ?? null;

    // 1) audit log：未来同邮箱新注册可查到此事件做 priorPurgeCount 累计
    try {
      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        userId: u.id,
        action: 'user.hard_purged',
        resource: 'user',
        resourceId: u.id,
        metadata: {
          emailNormalizedHistorical: historicalNormalized,
          tombstonedAt: u.deletedAt?.toISOString() ?? null,
          purgedAt: now.toISOString(),
        },
        createdAt: now,
      });
    } catch (e) {
      console.error(`[user-purge] failed to write audit log for ${u.id}:`, e);
      // 继续删，不让 audit 失败阻塞 GDPR 删除义务
    }

    // 2) 物理删除（schema 上的级联 FK 会自动清掉 accounts/sessions/policies/...）
    try {
      await db.delete(users).where(eq(users.id, u.id));
      results.push({
        userId: u.id,
        emailNormalizedHistorical: historicalNormalized,
        tombstonedAt: u.deletedAt?.toISOString() ?? '',
      });
    } catch (e) {
      console.error(`[user-purge] hard-delete failed for ${u.id}:`, e);
    }
  }

  console.log(`[user-purge] purged ${results.length} tombstoned user(s) past grace`);

  return NextResponse.json({
    purged: results.length,
    results,
  });
}

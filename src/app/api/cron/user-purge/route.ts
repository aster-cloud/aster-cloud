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
import { requireCronAuth } from '@/lib/cron-auth';
import { db, users, auditLogs } from '@/lib/prisma';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { runCronOnce } from '@/lib/cron-lease';
import { parseCronWindow } from '@/lib/cron-window';
import { purgeUserVocabulary } from '@/lib/domain-vocabulary-retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PurgeResult {
  userId: string;
  emailNormalizedHistorical: string | null;
  tombstonedAt: string;
}

export async function POST(req: NextRequest) {
  // R21-Critical-2: fail-closed cron auth via shared helper
  const guard = requireCronAuth(req);
  if (guard) return guard;

  const { acquiredBy, windowStart } = parseCronWindow(req, 'user-purge');
  const outcome = await runCronOnce(
    'user-purge',
    async () => {
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

        // 2a) UserVocabularySnapshot.ownerId 没有 FK 级联（schema 决定，
        // 因为 v2 会加 team-shared snapshot，ownerId 类型多态）。purge 前
        // 显式删一遍，否则会留下孤儿快照行违反 GDPR 删除义务。
        try {
          await purgeUserVocabulary(u.id);
        } catch (e) {
          console.error(`[user-purge] vocabulary purge failed for ${u.id}:`, e);
          // 不阻塞主流程：FK 级联会清掉 UserDomainTerm；snapshot 残留是
          // 已知降级状态，ops 可以离线清理。
        }

        // 2b) 物理删除（schema 上的级联 FK 会自动清掉 accounts/sessions/policies/...）
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
      return results;
    },
    { acquiredBy, windowStart },
  );

  if (!outcome.ran) {
    return NextResponse.json({
      skipped: true,
      reason: outcome.skippedReason,
      windowStart: outcome.windowStart,
    });
  }
  const results = outcome.result ?? [];
  return NextResponse.json({
    purged: results.length,
    results,
    windowStart: outcome.windowStart,
  });
}

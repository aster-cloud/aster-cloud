/**
 * 用户软删 + 30 天 grace + 同身份复活的中央逻辑。
 *
 * 状态机：
 *
 *   active  ──delete──▶  tombstoned  ──+30d cron──▶  hard-purged
 *      ▲                     │
 *      └─────reactivate──────┘
 *
 * - tombstoned (deletedAt 非空)：signIn 拒绝；但同邮箱重登可触发 reactivate
 * - hard-purged: 整行物理删除，priorPurgeCount 信息丢失（GDPR-friendly）
 *
 * 详见 src/app/api/user/delete/route.ts、src/auth.ts、src/app/api/cron/user-purge/route.ts。
 */

import { eq } from 'drizzle-orm';
import type { Database } from '@/db';
import { users } from '@/db/schema';

export const GRACE_PERIOD_DAYS = 30;

export interface TombstonedUser {
  id: string;
  email: string | null;
  deletedAt: Date;
  purgePendingUntil: Date | null;
  reactivationCount: number;
}

/**
 * 标记 user 为软删（不影响其他表的级联；purge cron 时再级联清理）。
 *
 * 同时把 emailNormalized 改成 "{原值}#deleted-{epoch}"，让 partial unique
 * index 不再阻塞同邮箱新注册（虽然 grace 期内新注册会被 reactivate 拦截，
 * 但 hard-purge 与新注册之间存在 race window，宁可让墓碑不占索引位）。
 */
export async function softDeleteUser(db: Database, userId: string): Promise<void> {
  const now = new Date();
  const purgeAt = new Date(now.getTime() + GRACE_PERIOD_DAYS * 86400_000);

  const existing = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { emailNormalized: true },
  });

  // emailNormalized 加 "#deleted-{ts}" 后缀以释放唯一索引位
  const tombstonedNormalized = existing?.emailNormalized
    ? `${existing.emailNormalized}#deleted-${now.getTime()}`
    : null;

  await db.update(users)
    .set({
      deletedAt: now,
      purgePendingUntil: purgeAt,
      emailNormalized: tombstonedNormalized,
      updatedAt: now,
    })
    .where(eq(users.id, userId));
}

/**
 * 找到归一邮箱对应的墓碑用户（grace 期内）。
 *
 * 因为软删时 emailNormalized 被改成 "{原值}#deleted-{ts}"，这里用 LIKE 查找。
 * 返回最近一次软删的用户（如有多个，理论上不会发生）。
 */
export async function findTombstonedUserByNormalizedEmail(
  db: Database,
  emailNormalized: string,
): Promise<TombstonedUser | null> {
  const rows = await db.query.users.findMany({
    where: (u, { like, and, isNotNull, gt }) => and(
      like(u.emailNormalized, `${emailNormalized}#deleted-%`),
      isNotNull(u.deletedAt),
      // 仍在 grace 期内：purgePendingUntil > now()
      gt(u.purgePendingUntil, new Date()),
    ),
    columns: {
      id: true,
      email: true,
      deletedAt: true,
      purgePendingUntil: true,
      reactivationCount: true,
    },
    orderBy: (u, { desc }) => [desc(u.deletedAt)],
    limit: 1,
  });

  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: r.id,
    email: r.email ?? null,
    deletedAt: r.deletedAt!,
    purgePendingUntil: r.purgePendingUntil,
    reactivationCount: r.reactivationCount,
  };
}

/**
 * 把墓碑用户复活：清 deletedAt / purgePendingUntil，emailNormalized 还原。
 *
 * 调用方应保证 user 仍在 grace 期内（用 findTombstonedUserByNormalizedEmail 拿到）。
 */
export async function reactivateUser(
  db: Database,
  userId: string,
  normalizedEmail: string,
): Promise<void> {
  await db.update(users)
    .set({
      deletedAt: null,
      purgePendingUntil: null,
      emailNormalized: normalizedEmail,
      reactivationCount: (await currentReactivationCount(db, userId)) + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

async function currentReactivationCount(db: Database, userId: string): Promise<number> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { reactivationCount: true },
  });
  return row?.reactivationCount ?? 0;
}

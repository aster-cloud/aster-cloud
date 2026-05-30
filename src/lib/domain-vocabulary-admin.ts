/**
 * Admin-side metrics queries for the user-domain-vocabulary surface.
 *
 * Each function is read-only and runs against the live tables. Caller is
 * responsible for the admin permission gate (the F9 dashboard mounts
 * inside /admin which has isAdminFromSession + ReadOnlyBanner).
 */

import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  db,
  domainTerms,
  lexiconBulkJobs,
  userDomainTerms,
  userVocabularySnapshots,
  users,
} from '@/lib/prisma';

export interface VocabularyAdminOverview {
  activeLinks: number;
  archivedLinks: number;
  uniqueUsers: number;
  globalTerms: number;
  snapshots: number;
  archivedSnapshots: number;
}

/** Single aggregate counters used by the F9 dashboard "at-a-glance" row. */
export async function getVocabularyAdminOverview(): Promise<VocabularyAdminOverview> {
  const [
    [activeLinks],
    [archivedLinks],
    [uniqueUsers],
    [globalTerms],
    [snapshots],
    [archivedSnapshots],
  ] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(userDomainTerms)
      .where(and(isNull(userDomainTerms.deletedAt), isNull(userDomainTerms.archivedAt))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(userDomainTerms)
      .where(isNotNull(userDomainTerms.archivedAt)),
    db
      .select({ c: sql<number>`count(distinct ${userDomainTerms.userId})::int` })
      .from(userDomainTerms)
      .where(isNull(userDomainTerms.deletedAt)),
    db.select({ c: sql<number>`count(*)::int` }).from(domainTerms),
    db.select({ c: sql<number>`count(*)::int` }).from(userVocabularySnapshots),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(userVocabularySnapshots)
      .where(isNotNull(userVocabularySnapshots.archivedAt)),
  ]);

  return {
    activeLinks: activeLinks?.c ?? 0,
    archivedLinks: archivedLinks?.c ?? 0,
    uniqueUsers: uniqueUsers?.c ?? 0,
    globalTerms: globalTerms?.c ?? 0,
    snapshots: snapshots?.c ?? 0,
    archivedSnapshots: archivedSnapshots?.c ?? 0,
  };
}

export interface TopUserEntry {
  userId: string;
  email: string | null;
  activeLinks: number;
  plan: string;
}

/** Top-N users by active link count for capacity planning. */
export async function getTopVocabularyUsers(limit = 10): Promise<TopUserEntry[]> {
  const rows = await db
    .select({
      userId: userDomainTerms.userId,
      activeLinks: sql<number>`count(*)::int`,
      email: users.email,
      plan: users.plan,
    })
    .from(userDomainTerms)
    .innerJoin(users, eq(users.id, userDomainTerms.userId))
    .where(and(isNull(userDomainTerms.deletedAt), isNull(userDomainTerms.archivedAt)))
    .groupBy(userDomainTerms.userId, users.email, users.plan)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email ?? null,
    activeLinks: r.activeLinks,
    plan: r.plan ?? 'free',
  }));
}

export interface BulkJobAggregateEntry {
  status: string;
  count: number;
  totalRows: number;
}

/** Roll up bulk job stats over a recent window for incident triage. */
export async function getRecentBulkJobAggregates(
  windowMs = 24 * 60 * 60 * 1000,
): Promise<BulkJobAggregateEntry[]> {
  const since = new Date(Date.now() - windowMs);
  const rows = await db
    .select({
      status: lexiconBulkJobs.status,
      count: sql<number>`count(*)::int`,
      totalRows: sql<number>`coalesce(sum(${lexiconBulkJobs.rowCount}), 0)::int`,
    })
    .from(lexiconBulkJobs)
    .where(gte(lexiconBulkJobs.createdAt, since))
    .groupBy(lexiconBulkJobs.status)
    .orderBy(desc(sql`count(*)`));

  return rows.map((r) => ({
    status: r.status,
    count: r.count,
    totalRows: r.totalRows,
  }));
}

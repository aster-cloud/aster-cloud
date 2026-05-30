/**
 * GET /api/admin/metrics — Prometheus text exposition。
 *
 * 管理端点；metrics label 不包含 licenseId/customer 等敏感字段。
 * Prometheus scrape 应通过内网 / NetworkPolicy 限制；本端点要求 admin session。
 */

import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import {
  db,
  domainTerms,
  licenseCache,
  revocationPublications,
  userDomainTerms,
  userVocabularySnapshots,
} from '@/lib/prisma';
import {
  licenseMetricsContentType,
  renderLicenseMetrics,
  setLicenseCacheAgeSeconds,
  setRevocationManifestVersion,
  setRevokedLicensesActive,
} from '@/lib/license-metrics';
import { renderTrialMetrics } from '@/lib/trial-metrics';
import {
  renderLexiconMetrics,
  setLexiconSnapshotTotal,
  setLexiconTermTotal,
  setLexiconUserLinkTotal,
} from '@/lib/lexicon-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEXICON_GAUGE_TTL_MS = 60_000;
let lastLexiconGaugeRefreshAt = 0;

async function maybeRefreshLexiconGauges(): Promise<void> {
  const now = Date.now();
  if (now - lastLexiconGaugeRefreshAt < LEXICON_GAUGE_TTL_MS) return;
  lastLexiconGaugeRefreshAt = now;
  try {
    const [termBySource, activeLinkCount, snapshotCount] = await Promise.all([
      db
        .select({ source: domainTerms.source, count: sql<number>`count(*)::int` })
        .from(domainTerms)
        .groupBy(domainTerms.source),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userDomainTerms)
        .where(and(isNull(userDomainTerms.deletedAt), isNull(userDomainTerms.archivedAt))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(userVocabularySnapshots),
    ]);
    for (const row of termBySource) {
      setLexiconTermTotal(row.source, row.count ?? 0);
    }
    setLexiconUserLinkTotal(activeLinkCount[0]?.count ?? 0);
    setLexiconSnapshotTotal(snapshotCount[0]?.count ?? 0);
  } catch (err) {
    // Surface for ops without breaking the metrics response — Prometheus
    // continues to scrape the (now stale) cached gauges.
    console.error('[admin/metrics] lexicon gauge refresh failed', err);
  }
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  // 在 render 前用最新 DB snapshot 更新 gauge
  const now = Date.now();
  const [cache, revoked, publication] = await Promise.all([
    db.query.licenseCache.findFirst({
      where: eq(licenseCache.id, 'current'),
    }),
    db.query.revokedLicenses.findMany({
      columns: { licenseId: true },
    }),
    db.query.revocationPublications.findFirst({
      orderBy: [desc(revocationPublications.version)],
    }),
  ]);

  setRevokedLicensesActive(revoked.length);
  setRevocationManifestVersion(publication?.version ?? null);
  setLicenseCacheAgeSeconds(
    cache?.lastSuccessfulRevocationCheckAt
      ? (now - cache.lastSuccessfulRevocationCheckAt.getTime()) / 1000
      : null,
  );

  // Refresh lexicon gauges. The counts move slowly relative to a 30s
  // Prometheus scrape and aggregating across all rows on every request is
  // wasteful, so cache the gauges per-process for LEXICON_GAUGE_TTL_MS.
  // Cache is best-effort: if the refresh throws, we leave the existing
  // gauge values in place and continue rendering.
  await maybeRefreshLexiconGauges();

  // Concatenate license + trial + lexicon exposition. Each registry shares
  // the text/plain content type produced by prom-client; the consumer
  // (Prometheus scraper) parses each metric block independently, so a
  // simple newline join is enough — no need for a combined registry.
  const [licenseText, trialText, lexiconText] = await Promise.all([
    renderLicenseMetrics(),
    renderTrialMetrics(),
    renderLexiconMetrics(),
  ]);
  const parts = [licenseText];
  if (trialText) parts.push(trialText);
  if (lexiconText) parts.push(lexiconText);
  const body = parts.join('\n');

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': licenseMetricsContentType(),
      'Cache-Control': 'no-store',
    },
  });
}

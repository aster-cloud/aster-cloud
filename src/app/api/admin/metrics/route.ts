/**
 * GET /api/admin/metrics — Prometheus text exposition。
 *
 * 管理端点；metrics label 不包含 licenseId/customer 等敏感字段。
 * Prometheus scrape 应通过内网 / NetworkPolicy 限制；本端点要求 admin session。
 */

import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import {
  db,
  licenseCache,
  revocationPublications,
} from '@/lib/prisma';
import {
  licenseMetricsContentType,
  renderLicenseMetrics,
  setLicenseCacheAgeSeconds,
  setRevocationManifestVersion,
  setRevokedLicensesActive,
} from '@/lib/license-metrics';
import { renderTrialMetrics } from '@/lib/trial-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  // Concatenate license + trial exposition. Both registries share the
  // text/plain content type produced by prom-client; the consumer
  // (Prometheus scraper) parses each metric block independently, so a
  // simple newline join is enough — no need for a combined registry.
  const [licenseText, trialText] = await Promise.all([
    renderLicenseMetrics(),
    renderTrialMetrics(),
  ]);
  const body = trialText ? `${licenseText}\n${trialText}` : licenseText;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': licenseMetricsContentType(),
      'Cache-Control': 'no-store',
    },
  });
}

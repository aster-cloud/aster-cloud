/**
 * /admin/issued-licenses — SaaS-only Aster-ops view of all licenses ever
 * signed + their renewal lineage + latest telemetry signal.
 *
 * Two purposes:
 *   1. Renewal review: at customer review time, ops opens a customer's
 *      row and sees the whole chain (which license was renewed from
 *      which) + the most recent telemetry counters for tier-fit.
 *   2. Incident triage: "this customer says their license stopped working" —
 *      look at supersededAt + the lineage to confirm whether they're
 *      still on the old one or never installed the new one.
 *
 * Server-rendered list; no client-side state. Pagination via query
 * string. RSC reads issued_licenses + license_telemetry directly (no
 * extra API roundtrip).
 *
 * Hidden in on-prem (notFound + sidebar excludes via IS_SAAS).
 */

import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { desc, eq } from 'drizzle-orm';
import { isAdminFromSession } from '@/lib/admin-auth';
import { IS_SAAS } from '@/lib/deployment-mode';
import { db, issuedLicenses, licenseTelemetry } from '@/lib/prisma';
import { IssuedLicensesTable } from './components/issued-licenses-table';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; cursor?: string }>;
};

const PAGE_SIZE = 50;

export default async function IssuedLicensesPage({ params, searchParams }: Props) {
  if (!IS_SAAS) notFound();
  const admin = await isAdminFromSession();
  if (!admin) notFound();

  const { locale } = await params;
  setRequestLocale(locale);

  const { q, cursor } = await searchParams;
  const t = await getTranslations('admin.issuedLicenses');

  // Pagination via signedAt cursor (rows sorted DESC by signedAt). We
  // don't expose cursor pagination yet for v1 — keep simple top-N + search.
  void cursor;
  const rows = await db.query.issuedLicenses.findMany({
    orderBy: [desc(issuedLicenses.signedAt)],
    limit: PAGE_SIZE,
  });

  // Filter client-side for v1 (small N, ops-only page).
  const filtered = q
    ? rows.filter(
        (r) =>
          r.customer.toLowerCase().includes(q.toLowerCase()) ||
          r.licenseId.toLowerCase().includes(q.toLowerCase()),
      )
    : rows;

  // For each row, fetch latest telemetry (one extra round-trip per row;
  // could be N+1 — acceptable for ops page at PAGE_SIZE=50, will move to
  // a JOIN if perf becomes an issue).
  const enriched = await Promise.all(
    filtered.map(async (row) => {
      const latest = await db.query.licenseTelemetry.findFirst({
        where: eq(licenseTelemetry.licenseId, row.licenseId),
        orderBy: [desc(licenseTelemetry.receivedAt)],
      });
      return { ...row, latestTelemetry: latest ?? null };
    }),
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
      </header>
      <IssuedLicensesTable rows={enriched} searchQuery={q ?? ''} />
    </div>
  );
}

export const metadata = {
  title: 'Issued Licenses',
};

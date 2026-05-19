/**
 * POST /api/cron/license-renewal-overlap-expiry — SaaS-side cleanup cron.
 *
 * Once an old license has been superseded by a renewal (supersededBy set
 * by webhook), it's still valid for RENEWAL_OVERLAP_DAYS (default 7) so
 * the customer has time to deploy the new env vars. After that window:
 *   1. Mark IssuedLicense.supersededAt = now.
 *   2. Insert into RevokedLicense (consumed by revocation publisher cron).
 *
 * Why split from webhook (instead of just-in-time during checkout):
 *   Customer needs the overlap to actually run both versions. Burning the
 *   old license at checkout time would lock anyone whose deployment is
 *   slow to roll. Cron drives the closing edge, on schedule, idempotent.
 *
 * Idempotency: insert into RevokedLicense is `INSERT ... ON CONFLICT DO
 * NOTHING` via the existing unique constraint on licenseId. supersededAt
 * stamp is the marker that says "this row is done"; cron skips rows whose
 * supersededAt is already set.
 *
 * SaaS-only. 404 on-prem.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, isNotNull, isNull, sql } from 'drizzle-orm';
import { requireCronAuth } from '@/lib/cron-auth';
import { IS_SAAS } from '@/lib/deployment-mode';
import { db, issuedLicenses, revokedLicenses } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Report {
  licenseId: string;
  supersededBy: string;
  outcome: 'revoked' | 'already-revoked';
}

export async function POST(req: NextRequest) {
  if (!IS_SAAS) return new NextResponse(null, { status: 404 });
  const guard = requireCronAuth(req);
  if (guard) return guard;

  const overlapDays = Math.max(
    1,
    Number.parseInt(process.env.RENEWAL_OVERLAP_DAYS ?? '7', 10) || 7,
  );
  const now = new Date();
  const cutoff = new Date(now.getTime() - overlapDays * DAY_MS);

  // 找 (有继任 + 未撤销 + 继任者签发已超过 overlap 窗口) 的 license。
  // signedAt 取继任者的（用子查询）以保证窗口从"新 license 真正签发那刻"算起，
  // 而不是 webhook 处理时间（避免 webhook 重试拉长窗口）。
  const rows = await db.query.issuedLicenses.findMany({
    where: and(
      isNotNull(issuedLicenses.supersededBy),
      isNull(issuedLicenses.supersededAt),
    ),
  });

  const report: Report[] = [];
  for (const row of rows) {
    // 获取继任者的 signedAt
    const successor = await db.query.issuedLicenses.findFirst({
      where: sql`${issuedLicenses.licenseId} = ${row.supersededBy}`,
    });
    if (!successor) {
      // 继任者数据缺失 — alert 但不阻塞 batch
      console.error('[overlap-expiry] orphaned supersededBy', {
        licenseId: row.licenseId,
        supersededBy: row.supersededBy,
      });
      continue;
    }
    if (successor.signedAt > cutoff) continue; // 还在 overlap 内

    // 写 revocation 表（已有则跳过；revoke-publisher cron 后续会把它纳入 manifest）
    const existing = await db.query.revokedLicenses.findFirst({
      where: sql`${revokedLicenses.licenseId} = ${row.licenseId}`,
    });
    if (existing) {
      // 仅同步 supersededAt（之前可能写过 revoke 但没回写）
      await db
        .update(issuedLicenses)
        .set({ supersededAt: now })
        .where(sql`${issuedLicenses.licenseId} = ${row.licenseId}`);
      report.push({
        licenseId: row.licenseId,
        supersededBy: row.supersededBy ?? '',
        outcome: 'already-revoked',
      });
      continue;
    }

    await db.insert(revokedLicenses).values({
      licenseId: row.licenseId,
      revokedBy: 'system:overlap-expiry',
      reason: 'renewal-superseded',
    });
    await db
      .update(issuedLicenses)
      .set({ supersededAt: now })
      .where(sql`${issuedLicenses.licenseId} = ${row.licenseId}`);
    report.push({
      licenseId: row.licenseId,
      supersededBy: row.supersededBy ?? '',
      outcome: 'revoked',
    });
  }

  return NextResponse.json({
    overlapDays,
    cutoff: cutoff.toISOString(),
    scanned: rows.length,
    revoked: report.filter((r) => r.outcome === 'revoked').length,
    skipped: report.filter((r) => r.outcome === 'already-revoked').length,
    items: report,
  });
}

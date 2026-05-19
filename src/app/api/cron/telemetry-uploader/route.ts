/**
 * POST /api/cron/telemetry-uploader — on-prem nightly telemetry upload.
 *
 * Behavior:
 *   - Returns 404 when not on-prem (telemetry is on-prem→SaaS).
 *   - Returns 204 when opt-out (ASTER_TELEMETRY_OPT_IN != "1"). The
 *     entire upload code path is dead in this case; bundle never
 *     resolves DNS or opens a socket.
 *   - Validates the local license before reading any usage data — if
 *     the license isn't verified we don't have a credible
 *     periodStart/periodEnd to report against.
 *   - Builds payload via payload-builder (aggregate-only, no PII).
 *   - Uploads via uploader (HMAC); transient errors return 503 so
 *     CRON_SECRET-authenticated callers can re-trigger; fatal errors
 *     return 400 with reason so ops know to inspect config.
 *
 * Idempotency: SaaS dedupes by (licenseId, periodStart, periodEnd).
 * Re-running the cron in the same window is a no-op SaaS-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireCronAuth } from '@/lib/cron-auth';
import { IS_ONPREM } from '@/lib/deployment-mode';
import { db, licenseCache } from '@/lib/prisma';
import { verifyLicenseKey } from '@/lib/license';
import {
  buildTelemetryPayload,
  type TelemetryPayload,
} from '@/lib/telemetry/payload-builder';
import { TelemetryUploadError, uploadTelemetry } from '@/lib/telemetry/uploader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TelemetryResponse {
  uploaded: boolean;
  deduped?: boolean;
  reason?: string;
  payload?: TelemetryPayload;
  ingestId?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!IS_ONPREM) return new NextResponse(null, { status: 404 });

  const guard = requireCronAuth(req);
  if (guard) return guard;

  // Opt-in switch. Anything other than literal "1" is opt-out.
  const optIn = process.env.ASTER_TELEMETRY_OPT_IN === '1';
  if (!optIn) {
    const body: TelemetryResponse = { uploaded: false, reason: 'opt-out' };
    return NextResponse.json(body, { status: 204 });
  }

  const endpoint = process.env.ASTER_TELEMETRY_ENDPOINT?.trim();
  const secret = process.env.ASTER_TELEMETRY_SECRET?.trim();
  const secretKid = process.env.ASTER_TELEMETRY_SECRET_KID?.trim() || 'default';
  if (!endpoint || !secret) {
    return NextResponse.json(
      { uploaded: false, reason: 'missing-config' } satisfies TelemetryResponse,
      { status: 500 },
    );
  }
  if (secret.length < 32) {
    return NextResponse.json(
      { uploaded: false, reason: 'weak-secret' } satisfies TelemetryResponse,
      { status: 500 },
    );
  }

  // Verify local license — get licenseId + deploymentId + customer
  // from the very payload we'll be reporting against.
  const cache = await db.query.licenseCache.findFirst({
    where: eq(licenseCache.id, 'current'),
  });
  if (!cache) {
    return NextResponse.json(
      { uploaded: false, reason: 'no-license-cache' } satisfies TelemetryResponse,
      { status: 503 },
    );
  }
  const result = await verifyLicenseKey(process.env.LICENSE_KEY);
  if (result.trustStatus !== 'verified' || !result.payload) {
    return NextResponse.json(
      { uploaded: false, reason: `license-not-verified:${result.trustStatus}` } satisfies TelemetryResponse,
      { status: 503 },
    );
  }

  const payload = await buildTelemetryPayload({ license: result.payload });
  const attemptedAt = new Date();

  const persistLocalRecord = async (record: Record<string, unknown>) => {
    // 写本地审计记录给 admin/license 透明视图。失败不阻塞上报。
    try {
      await db
        .update(licenseCache)
        .set({ lastTelemetryUpload: record, updatedAt: new Date() })
        .where(eq(licenseCache.id, 'current'));
    } catch (writeErr) {
      console.error('[telemetry-uploader] failed to write local audit', writeErr);
    }
  };

  try {
    const upload = await uploadTelemetry(payload, {
      endpoint,
      secret,
      secretKid,
      licenseId: result.payload.licenseId,
      deploymentId: result.payload.deploymentBinding.deploymentId,
      customer: result.payload.customer,
    });
    await persistLocalRecord({
      payload,
      attemptedAt: attemptedAt.toISOString(),
      outcome: upload.deduped ? 'deduped' : 'accepted',
      ingestId: upload.id,
    });
    return NextResponse.json({
      uploaded: true,
      deduped: upload.deduped,
      payload,
      ingestId: upload.id,
    } satisfies TelemetryResponse);
  } catch (err) {
    if (err instanceof TelemetryUploadError) {
      await persistLocalRecord({
        payload,
        attemptedAt: attemptedAt.toISOString(),
        outcome: 'failed',
        errorKind: err.kind,
        errorStatus: err.status,
        errorMessage: err.message.slice(0, 500),
      });
      const status = err.kind === 'transient' ? 503 : 400;
      return NextResponse.json(
        {
          uploaded: false,
          reason: `${err.kind}:${err.status ?? 'network'}`,
        } satisfies TelemetryResponse,
        { status },
      );
    }
    throw err;
  }
}

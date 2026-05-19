/**
 * POST /api/v1/telemetry — SaaS-side ingest for opt-in license telemetry.
 *
 * Auth model: per-license HMAC-SHA256. The shared secret is created
 * server-side when the license is signed and handed to the customer
 * alongside the license key + ASTER_DEPLOYMENT_ID. Customer uploaders
 * sign their body and send signature in the x-aster-signature header;
 * we look up the secret by (licenseId, kid) and verify constant-time.
 *
 * Replay defense: (licenseId, periodStart, periodEnd) UNIQUE on the row.
 * Duplicate uploads are absorbed silently (returned as deduped=true),
 * so producers can retry without bookkeeping.
 *
 * No login required (deployment-side cron is unauthenticated to our IdP).
 * Rate-limited at the edge (Cloudflare rules) so we don't gate here.
 *
 * SaaS-only. on-prem build returns 404.
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { IS_SAAS } from '@/lib/deployment-mode';
import { db, issuedLicenses, licenseTelemetry } from '@/lib/prisma';
import { verifyTelemetrySignature } from '@/lib/telemetry/uploader';
import {
  resolveTelemetrySecret,
  type ResolvedSecret,
} from '@/lib/telemetry/secret-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InboundPayload {
  schemaVersion: number;
  periodStart: string;
  periodEnd: string;
  activeSeats: number;
  policiesActive: number;
  policyExecutionsCount: number;
  totalProvisionedSeats: number;
  seatLimitHit: boolean;
  featuresUsed: string[];
  appVersion?: string;
  nodeVersion?: string;
}

function bad(reason: string, status = 400): NextResponse {
  // Don't echo specifics that would help an attacker probe for a
  // valid license id; "rejected" is enough for the customer's logs.
  return NextResponse.json({ error: 'rejected', reason }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!IS_SAAS) return new NextResponse(null, { status: 404 });

  // Headers must be present + plausible shape *before* we touch DB.
  const licenseId = req.headers.get('x-aster-license-id')?.trim() ?? '';
  const deploymentId = req.headers.get('x-aster-deployment-id')?.trim().toLowerCase() ?? '';
  const customer = req.headers.get('x-aster-customer')?.trim() ?? '';
  const sigKid = req.headers.get('x-aster-signature-kid')?.trim() ?? '';
  const sigAlg = req.headers.get('x-aster-signature-alg')?.trim() ?? '';
  const signature = req.headers.get('x-aster-signature')?.trim() ?? '';

  if (!licenseId || !deploymentId || !customer || !sigKid || !signature) {
    return bad('missing-required-headers');
  }
  if (sigAlg !== 'HMAC-SHA256') return bad('unsupported-signature-alg');
  if (!/^[0-9a-f]{64}$/.test(deploymentId)) return bad('malformed-deployment-id');

  // Read raw body — we must hash the *exact* bytes the producer signed,
  // not a re-serialized version. JSON parsed only after signature passes.
  const rawBody = await req.text();
  if (rawBody.length > 64 * 1024) return bad('payload-too-large', 413);

  // Resolve the secret. Errors surface as generic 'rejected' to avoid
  // leaking which IDs exist. resolveTelemetrySecret() handles all the
  // lookup edge cases (license unknown / kid retired / etc.).
  let secret: ResolvedSecret | null;
  try {
    secret = await resolveTelemetrySecret({ licenseId, kid: sigKid });
  } catch {
    return bad('signature-verify-failed');
  }
  if (!secret) return bad('signature-verify-failed');

  if (!verifyTelemetrySignature(secret.secret, rawBody, signature)) {
    return bad('signature-verify-failed');
  }

  // Optional: cross-check that the calling deployment matches what the
  // license was signed for. If the license carries a deploymentBinding
  // (it should — v3 makes it required), reject mismatched IDs even if
  // the HMAC checks out. This catches a key-rotation mistake where ops
  // copied the wrong secret into a different cluster.
  const license = await db.query.issuedLicenses.findFirst({
    where: eq(issuedLicenses.licenseId, licenseId),
  });
  if (!license) return bad('signature-verify-failed');
  const expectedBinding = (license.deploymentBinding as { deploymentId?: string })
    ?.deploymentId?.toLowerCase();
  if (expectedBinding && expectedBinding !== deploymentId) {
    return bad('deployment-id-mismatch');
  }
  if (license.customer !== customer) return bad('customer-mismatch');

  // Parse + minimal shape validation. Anything funky → 400.
  let payload: InboundPayload;
  try {
    payload = JSON.parse(rawBody) as InboundPayload;
  } catch {
    return bad('malformed-json');
  }
  if (
    typeof payload.schemaVersion !== 'number' ||
    typeof payload.periodStart !== 'string' ||
    typeof payload.periodEnd !== 'string' ||
    typeof payload.activeSeats !== 'number' ||
    typeof payload.policiesActive !== 'number' ||
    typeof payload.policyExecutionsCount !== 'number' ||
    typeof payload.totalProvisionedSeats !== 'number' ||
    typeof payload.seatLimitHit !== 'boolean' ||
    !Array.isArray(payload.featuresUsed)
  ) {
    return bad('malformed-payload');
  }
  const periodStart = new Date(payload.periodStart);
  const periodEnd = new Date(payload.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return bad('malformed-period');
  }
  if (periodEnd.getTime() <= periodStart.getTime()) return bad('inverted-period');
  const now = Date.now();
  // 不接受 24h 以上"未来"的窗口（防 clock 攻击 / 误用）+ 不接受 1 年前的
  if (periodEnd.getTime() > now + 24 * 3600_000) return bad('period-in-future');
  if (periodStart.getTime() < now - 365 * 24 * 3600_000) return bad('period-too-old');

  // Persist. ON CONFLICT DO NOTHING is the dedup contract — same
  // window from same license is a no-op.
  const id = randomUUID();
  const sourceIp =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;

  // We can't ON CONFLICT via drizzle's generic insert easily here without
  // raw SQL; do a 2-step check + insert. The UNIQUE constraint catches
  // any concurrent race and we translate that to deduped=true.
  const existing = await db.query.licenseTelemetry.findFirst({
    where: and(
      eq(licenseTelemetry.licenseId, licenseId),
      eq(licenseTelemetry.periodStart, periodStart),
      eq(licenseTelemetry.periodEnd, periodEnd),
    ),
  });
  if (existing) {
    return NextResponse.json({ id: existing.id, deduped: true });
  }

  try {
    await db.insert(licenseTelemetry).values({
      id,
      licenseId,
      deploymentId,
      customer,
      periodStart,
      periodEnd,
      payload,
      sourceIp,
      signatureKid: sigKid,
      signatureAlg: sigAlg,
      signatureB64: signature,
    });
  } catch (err) {
    // UNIQUE violation = concurrent dedup race. Read back + return.
    const dup = await db.query.licenseTelemetry.findFirst({
      where: and(
        eq(licenseTelemetry.licenseId, licenseId),
        eq(licenseTelemetry.periodStart, periodStart),
        eq(licenseTelemetry.periodEnd, periodEnd),
      ),
    });
    if (dup) return NextResponse.json({ id: dup.id, deduped: true });
    throw err;
  }

  return NextResponse.json({ id, deduped: false });
}

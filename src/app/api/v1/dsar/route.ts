/**
 * POST /api/v1/dsar — customer self-service DSAR endpoint.
 *
 * Customers exercising GDPR Art 15 (right of access) or Art 17 (right
 * to erasure) for telemetry data can call this without a SaaS login.
 * Authentication is the same per-license HMAC scheme used by the
 * ingest endpoint — anyone who possesses the per-license secret +
 * deployment id can prove ownership of the license without needing
 * Aster-side credentials.
 *
 * Request body (HMAC-signed canonical JSON):
 *   {
 *     action: 'access' | 'delete',
 *     subject: 'license' | 'customer',
 *     // when subject='customer': permitted only when license.customer
 *     // matches — a license can DSAR its own customer's data, not
 *     // someone else's.
 *     dryRun?: boolean,    // default false
 *     dsarRef: string,     // customer-supplied ticket id (required for audit)
 *     nonce: string,       // 16+ chars, included in signature to prevent replay
 *     timestamp: string,   // ISO-8601; rejected if > 5 min skew
 *   }
 *
 * Response (200):
 *   action=access: { rows: TelemetryRow[], retainedFor90DaysAuditOnly: true }
 *   action=delete: { rowsDeleted: number, dryRun: boolean }
 *
 * Reject reasons (400):
 *   - 'rejected' for any auth failure (uniform shape, prevents probing)
 *   - 'invalid-action' / 'invalid-subject' for body shape errors
 *   - 'stale-timestamp' / 'invalid-nonce' for replay-defense
 *   - 'dsarRef-required' when action requires audit-trail proof
 *
 * Why same auth as ingest: the HMAC secret is delivered out-of-band
 * with the license key, and ops can revoke it by rotating the kid.
 * Setting up a separate "DSAR secret" would double the secret-rotation
 * surface for the same threat.
 *
 * SaaS-only. on-prem 404.
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { IS_SAAS } from '@/lib/deployment-mode';
import { db, issuedLicenses, licenseTelemetry } from '@/lib/prisma';
import { maskCustomer, verifyTelemetrySignature } from '@/lib/telemetry/uploader';
import {
  resolveTelemetrySecret,
  type ResolvedSecret,
} from '@/lib/telemetry/secret-store';
import {
  appendAccessAudit,
  deleteTelemetryByCustomer,
  deleteTelemetryByLicense,
} from '@/lib/telemetry/access-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 8 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

interface InboundDsarBody {
  action: 'access' | 'delete';
  subject: 'license' | 'customer';
  dryRun?: boolean;
  dsarRef: string;
  nonce: string;
  timestamp: string;
}

function bad(reason: string, status = 400): NextResponse {
  return NextResponse.json({ error: 'rejected', reason }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!IS_SAAS) return new NextResponse(null, { status: 404 });

  // Auth headers — identical contract to /api/v1/telemetry except we
  // don't require x-aster-deployment-id (DSAR doesn't carry a payload
  // bound to a deployment), but we still cross-check it when supplied
  // because mismatched cluster + license is a strong signal of stolen
  // credentials.
  const licenseId = req.headers.get('x-aster-license-id')?.trim() ?? '';
  const customer = req.headers.get('x-aster-customer')?.trim() ?? '';
  const sigKid = req.headers.get('x-aster-signature-kid')?.trim() ?? '';
  const sigAlg = req.headers.get('x-aster-signature-alg')?.trim() ?? '';
  const signature = req.headers.get('x-aster-signature')?.trim() ?? '';
  const deploymentId = req.headers.get('x-aster-deployment-id')?.trim().toLowerCase() ?? '';

  if (!licenseId || !customer || !sigKid || !signature) {
    return bad('missing-required-headers');
  }
  if (sigAlg !== 'HMAC-SHA256') return bad('unsupported-signature-alg');

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY) return bad('payload-too-large', 413);

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

  const license = await db.query.issuedLicenses.findFirst({
    where: eq(issuedLicenses.licenseId, licenseId),
  });
  if (!license) return bad('signature-verify-failed');

  // Optional deployment-id cross-check — same logic as ingest. We do
  // it after HMAC so a leaked secret used from a different cluster
  // still gets caught.
  if (deploymentId) {
    if (!/^[0-9a-f]{64}$/.test(deploymentId)) return bad('malformed-deployment-id');
    const expected = (license.deploymentBinding as { deploymentId?: string })
      ?.deploymentId?.toLowerCase();
    if (expected && expected !== deploymentId) return bad('deployment-id-mismatch');
  }

  // Customer cross-check — same masked-form-allowed as ingest.
  const expectedMasked = maskCustomer(license.customer);
  if (customer !== license.customer && customer !== expectedMasked) {
    return bad('customer-mismatch');
  }

  // Parse + validate body. Replay defense via timestamp + nonce; the
  // nonce isn't tracked server-side (would need an extra table) — the
  // timestamp window plus HMAC over the canonical body is sufficient
  // for the threat model (replay within 5 min only achieves the same
  // result the legitimate request would).
  let body: InboundDsarBody;
  try {
    body = JSON.parse(rawBody) as InboundDsarBody;
  } catch {
    return bad('malformed-json');
  }
  if (body.action !== 'access' && body.action !== 'delete') return bad('invalid-action');
  if (body.subject !== 'license' && body.subject !== 'customer') return bad('invalid-subject');
  if (typeof body.dsarRef !== 'string' || body.dsarRef.length === 0 || body.dsarRef.length > 200) {
    return bad('dsarRef-required');
  }
  if (typeof body.nonce !== 'string' || body.nonce.length < 16 || body.nonce.length > 200) {
    return bad('invalid-nonce');
  }
  const ts = Date.parse(body.timestamp ?? '');
  if (!Number.isFinite(ts)) return bad('invalid-timestamp');
  if (Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) return bad('stale-timestamp');

  const dryRun = body.dryRun === true;
  const requestId = req.headers.get('x-request-id') ?? undefined;
  const actorId = `customer-dsar:${licenseId}`;

  // ───── action=access ─────
  if (body.action === 'access') {
    const rows = await db.query.licenseTelemetry.findMany({
      where:
        body.subject === 'license'
          ? eq(licenseTelemetry.licenseId, licenseId)
          : eq(licenseTelemetry.customer, license.customer),
    });
    // Write the access audit FIRST so a crash during serialization
    // still leaves the evidence.
    await appendAccessAudit({
      action: 'read-list',
      actorId,
      subjectKind: body.subject === 'license' ? 'license' : 'customer',
      subjectKey: body.subject === 'license' ? licenseId : license.customer,
      metadata: { reason: 'dsar-access', dsarRef: body.dsarRef, rowsReturned: rows.length },
      requestId,
    });
    return NextResponse.json({
      action: 'access',
      subject: body.subject,
      rows,
      retainedFor90DaysAuditOnly: true,
    });
  }

  // ───── action=delete ─────
  if (body.subject === 'license') {
    const result = await deleteTelemetryByLicense({
      licenseId,
      actorId,
      reason: 'dsar',
      requestId,
      dsarRef: body.dsarRef,
      dryRun,
    });
    return NextResponse.json({
      action: 'delete',
      subject: 'license',
      licenseId,
      rowsDeleted: result.rowsDeleted,
      dryRun: result.dryRun,
    });
  }
  const result = await deleteTelemetryByCustomer({
    customer: license.customer,
    actorId,
    reason: 'dsar',
    requestId,
    dsarRef: body.dsarRef,
    dryRun,
  });
  return NextResponse.json({
    action: 'delete',
    subject: 'customer',
    customer: license.customer,
    rowsDeleted: result.rowsDeleted,
    dryRun: result.dryRun,
  });
}

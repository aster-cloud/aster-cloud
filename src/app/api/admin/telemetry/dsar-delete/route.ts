/**
 * POST /api/admin/telemetry/dsar-delete — purge a customer's or single
 * license's telemetry rows in response to a GDPR Art 17 / CCPA right-to-
 * delete request.
 *
 * Auth: SaaS admin only. Body identifies subject + reason + DSAR
 * reference number (recorded in the audit row for later proof of
 * compliance).
 *
 * Why not let customers self-serve from on-prem: they CAN — the env-flip
 * (ASTER_TELEMETRY_OPT_IN=0) stops new data. This endpoint is for the
 * SaaS-side post-revocation cleanup that customer can't reach.
 *
 * GDPR 1-month SLA: this synchronous path completes in milliseconds (deletes
 * a small number of rows); audit row carries the DSAR ref so ops can show
 * regulators "request X received on Y, fulfilled on Z".
 *
 * SaaS-only. 404 in on-prem.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { IS_SAAS } from '@/lib/deployment-mode';
import {
  deleteTelemetryByCustomer,
  deleteTelemetryByLicense,
} from '@/lib/telemetry/access-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Inline validator (zod isn't in this project's runtime deps).
type Reason = 'dsar' | 'support-request';
type ParsedRequest =
  | { subject: 'license'; licenseId: string; reason: Reason; dsarRef?: string; dryRun: boolean }
  | { subject: 'customer'; customer: string; reason: Reason; dsarRef?: string; dryRun: boolean };

function isReason(v: unknown): v is Reason {
  return v === 'dsar' || v === 'support-request';
}

function parseRequest(body: unknown): ParsedRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'invalid-body' };
  const b = body as Record<string, unknown>;
  if (!isReason(b.reason)) return { error: 'invalid-reason' };
  if (b.dsarRef !== undefined && (typeof b.dsarRef !== 'string' || b.dsarRef.length === 0)) {
    return { error: 'invalid-dsarRef' };
  }
  // dryRun is optional, defaults false. Anything other than a literal
  // boolean is rejected so a JSON typo doesn't accidentally apply a
  // deletion that the operator thought they were previewing.
  let dryRun = false;
  if (b.dryRun !== undefined) {
    if (typeof b.dryRun !== 'boolean') return { error: 'invalid-dryRun' };
    dryRun = b.dryRun;
  }
  if (b.subject === 'license') {
    if (typeof b.licenseId !== 'string' || b.licenseId.length === 0 || b.licenseId.length > 256) {
      return { error: 'invalid-licenseId' };
    }
    return {
      subject: 'license',
      licenseId: b.licenseId,
      reason: b.reason,
      dsarRef: b.dsarRef as string | undefined,
      dryRun,
    };
  }
  if (b.subject === 'customer') {
    if (typeof b.customer !== 'string' || b.customer.length === 0 || b.customer.length > 256) {
      return { error: 'invalid-customer' };
    }
    return {
      subject: 'customer',
      customer: b.customer,
      reason: b.reason,
      dsarRef: b.dsarRef as string | undefined,
      dryRun,
    };
  }
  return { error: 'invalid-subject' };
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!IS_SAAS) return new NextResponse(null, { status: 404 });

  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const raw = await req.json().catch(() => null);
  const parsed = parseRequest(raw);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (parsed.reason === 'dsar' && !parsed.dsarRef) {
    return NextResponse.json(
      { error: 'dsarRef-required', detail: 'reason=dsar requires dsarRef for audit trail' },
      { status: 400 },
    );
  }

  const requestId = req.headers.get('x-request-id') ?? undefined;

  if (parsed.subject === 'license') {
    const result = await deleteTelemetryByLicense({
      licenseId: parsed.licenseId,
      actorId: admin.userId,
      reason: parsed.reason,
      requestId,
      dsarRef: parsed.dsarRef,
      dryRun: parsed.dryRun,
    });
    return NextResponse.json({
      subject: 'license',
      licenseId: parsed.licenseId,
      rowsDeleted: result.rowsDeleted,
      dryRun: result.dryRun,
    });
  }

  const result = await deleteTelemetryByCustomer({
    customer: parsed.customer,
    actorId: admin.userId,
    reason: parsed.reason,
    requestId,
    dsarRef: parsed.dsarRef,
    dryRun: parsed.dryRun,
  });
  return NextResponse.json({
    subject: 'customer',
    customer: parsed.customer,
    rowsDeleted: result.rowsDeleted,
    dryRun: result.dryRun,
  });
}

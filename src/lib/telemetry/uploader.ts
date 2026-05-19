// Sign + upload a telemetry payload to the SaaS ingest endpoint.
//
// Auth model: HMAC-SHA256(secret, canonicalPayload). Secret is shared
// per-deployment at sign time (separate from license signing key — the
// license uses an asymmetric key, can't HMAC). Customer pastes secret
// into ASTER_TELEMETRY_SECRET; SaaS knows the same secret because Aster
// stores it server-side at license-issue time.
//
// Choice of HMAC over JWT: simpler, fewer moving parts, no clock-skew
// concerns. Replay defended SaaS-side by (licenseId, periodStart,
// periodEnd) uniqueness — replaying a window is harmless.
//
// Failure modes:
//   - Network error / timeout → throw transient. Cron retries next tick.
//   - 4xx → throw fatal. Caller logs but doesn't retry. Common cause:
//     secret rotated server-side or schema-version mismatch.
//   - 5xx → throw transient.
//   - SaaS replied 200 with payload echo → return success.

/* @deployment-mode-hot-gate
 * reason: telemetry uploader runs from on-prem builds. SaaS-side has
 *         no use for this module; marker keeps it from accidental import.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonicalizeTelemetry, type TelemetryPayload } from './payload-builder';

export interface UploadConfig {
  /** Full https URL to the ingest endpoint (no trailing slash). */
  endpoint: string;
  /** Per-deployment HMAC secret (≥ 32 chars). */
  secret: string;
  /** Identifier for the secret rotation: customer "default", or
   *  "rotated-2027-01" etc. Stored alongside in DB for audit. */
  secretKid: string;
  /** License + deployment context — proves we own this license. */
  licenseId: string;
  deploymentId: string;
  customer: string;
  /** Network timeout. Default 10s — telemetry isn't latency-critical. */
  timeoutMs?: number;
}

export interface UploadResult {
  /** Server-assigned ingest row id (echoed in response). */
  id: string;
  /** Whether the row was newly inserted vs treated as duplicate. */
  deduped: boolean;
}

export class TelemetryUploadError extends Error {
  constructor(
    public readonly kind: 'transient' | 'fatal',
    public readonly status: number | null,
    message: string,
  ) {
    super(`[telemetry-upload] ${kind} (status=${status ?? 'n/a'}): ${message}`);
    this.name = 'TelemetryUploadError';
  }
}

export async function uploadTelemetry(
  payload: TelemetryPayload,
  cfg: UploadConfig,
): Promise<UploadResult> {
  const body = canonicalizeTelemetry(payload);
  const signature = hmacBase64Url(cfg.secret, body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-aster-license-id': cfg.licenseId,
    'x-aster-deployment-id': cfg.deploymentId,
    'x-aster-customer': cfg.customer,
    'x-aster-signature-kid': cfg.secretKid,
    'x-aster-signature-alg': 'HMAC-SHA256',
    'x-aster-signature': signature,
  };

  const timeoutMs = cfg.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    throw new TelemetryUploadError(
      'transient',
      null,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 500) {
    throw new TelemetryUploadError(
      'transient',
      res.status,
      await res.text().catch(() => ''),
    );
  }
  if (res.status >= 400) {
    throw new TelemetryUploadError(
      'fatal',
      res.status,
      await res.text().catch(() => ''),
    );
  }

  const parsed = (await res.json().catch(() => null)) as
    | { id?: string; deduped?: boolean }
    | null;
  if (!parsed || typeof parsed.id !== 'string') {
    throw new TelemetryUploadError(
      'fatal',
      res.status,
      'malformed ingest response (missing id)',
    );
  }
  return { id: parsed.id, deduped: parsed.deduped === true };
}

function hmacBase64Url(secret: string, message: string): string {
  return createHmac('sha256', secret)
    .update(message, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Constant-time HMAC verify helper exposed for the SaaS ingest endpoint
 * to import. Reuses the exact same encoder + algo as the producer so
 * crypto stays in one file.
 */
export function verifyTelemetrySignature(
  secret: string,
  body: string,
  signatureB64Url: string,
): boolean {
  const expected = hmacBase64Url(secret, body);
  if (expected.length !== signatureB64Url.length) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureB64Url, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

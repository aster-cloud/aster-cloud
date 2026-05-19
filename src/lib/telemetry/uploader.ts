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

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { canonicalizeTelemetry, type TelemetryPayload } from './payload-builder';

/**
 * Mask a customer name to an opaque-but-correlatable token.
 *
 * Output shape: "anon-<12-hex>-<len>" — first 12 hex of sha256(customer)
 * + the original string length. SaaS ops can still group "all reports
 * from the same anonymous customer" but the literal name is not on the
 * wire and not in our DB.
 *
 * Used when the deployment sets ASTER_TELEMETRY_MASK_CUSTOMER=1. This
 * is the privacy-conservative default for new opt-ins; existing
 * deployments can adopt it without restart cost. We keep the original
 * "Acme Corp" format opt-out path because some customers explicitly
 * want their name attached for renewal conversations.
 */
export function maskCustomer(customer: string): string {
  const hex = createHash('sha256').update(customer, 'utf8').digest('hex').slice(0, 12);
  return `anon-${hex}-${customer.length}`;
}

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
  /** SaaS-side region that accepted the row (us / eu / apac / unknown). */
  dataRegion?: string;
}

export class TelemetryUploadError extends Error {
  constructor(
    public readonly kind: 'transient' | 'fatal' | 'unsupported-schema-version',
    public readonly status: number | null,
    message: string,
    /**
     * J4: SaaS-published supported versions, parsed from the 400 body
     * or x-aster-telemetry-supported-versions header when the kind is
     * 'unsupported-schema-version'. Empty otherwise.
     */
    public readonly supportedVersions: readonly number[] = [],
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
    const text = await res.text().catch(() => '');
    // J4: detect "your schema version is no longer accepted" so cron
    // can stop wasting tries until ops upgrades the on-prem build.
    const parsedReason = parseSchemaVersionRejection(text, res.headers);
    if (parsedReason) {
      throw new TelemetryUploadError(
        'unsupported-schema-version',
        res.status,
        `SaaS rejected schemaVersion; supported=${parsedReason.supportedVersions.join(',')}`,
        parsedReason.supportedVersions,
      );
    }
    throw new TelemetryUploadError('fatal', res.status, text);
  }

  const parsed = (await res.json().catch(() => null)) as
    | { id?: string; deduped?: boolean; dataRegion?: string }
    | null;
  if (!parsed || typeof parsed.id !== 'string') {
    throw new TelemetryUploadError(
      'fatal',
      res.status,
      'malformed ingest response (missing id)',
    );
  }
  return {
    id: parsed.id,
    deduped: parsed.deduped === true,
    dataRegion: typeof parsed.dataRegion === 'string' ? parsed.dataRegion : undefined,
  };
}

/**
 * Parse a 4xx body / headers to detect the J4 version-negotiation
 * rejection shape. Returns null when the response is some other 4xx
 * (bad signature, deployment mismatch, etc.) so callers don't conflate
 * "ops mistake" with "upgrade required". Tolerates both header-only
 * and JSON-body forms so a future contract change can drop one without
 * breaking older on-prem builds.
 */
function parseSchemaVersionRejection(
  body: string,
  headers: Headers,
): { supportedVersions: number[] } | null {
  let supportedFromHeader: number[] | null = null;
  const headerRaw = headers.get('x-aster-telemetry-supported-versions');
  if (headerRaw) {
    const nums = headerRaw
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (nums.length > 0) supportedFromHeader = nums;
  }

  try {
    const parsed = JSON.parse(body) as { reason?: string; supportedVersions?: unknown };
    if (parsed && parsed.reason === 'unsupported-schema-version') {
      const fromBody = Array.isArray(parsed.supportedVersions)
        ? parsed.supportedVersions
            .filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0)
        : null;
      return {
        supportedVersions: fromBody ?? supportedFromHeader ?? [],
      };
    }
  } catch {
    // not JSON; fall through
  }
  // Header alone is also a positive signal — body could be empty in
  // edge-case proxies that strip JSON.
  if (supportedFromHeader) {
    return { supportedVersions: supportedFromHeader };
  }
  return null;
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

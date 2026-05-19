// SaaS-side resolver for per-license telemetry HMAC secrets.
//
// Storage model (v1): secrets live alongside the IssuedLicense row in
// `payload_json.telemetry.secrets`, an array shaped:
//
//   { kid: string, secret: string, activatedAt: string, retiredAt?: string }
//
// The signing flow (license-issue.sh + signing-api) creates one entry
// with kid="default" at sign time. Future rotation appends new entries
// with new kids; retired entries get retiredAt set and become unusable.
//
// Why store on IssuedLicense payload rather than a dedicated table:
//   - 1:1 with license; never queried independently.
//   - Lifecycle matches license: revoke license = revoke secrets.
//   - One round-trip on ingest (already had to fetch the license to
//     validate deployment binding).
//
// Future-proofing: this module is the only place that reads the
// "telemetry.secrets" shape. If we move to KMS or a dedicated table
// the implementation swaps; callers see ResolvedSecret unchanged.

/* @deployment-mode-hot-gate
 * reason: secret resolver is SaaS-only — on-prem never holds other
 *         customers' secrets. Marker prevents accidental import.
 */

import { eq } from 'drizzle-orm';
import { db, issuedLicenses } from '@/lib/prisma';

export interface ResolvedSecret {
  /** Active secret bytes (utf8) for HMAC. */
  secret: string;
  /** Audit fields — echoed in the persisted telemetry row. */
  kid: string;
}

interface StoredSecret {
  kid: string;
  secret: string;
  activatedAt: string;
  retiredAt?: string;
}

interface TelemetryConfig {
  secrets?: StoredSecret[];
}

/**
 * Look up the secret for `(licenseId, kid)`. Returns null when:
 *   - license doesn't exist
 *   - license has no telemetry config (telemetry not enabled at sign time)
 *   - kid not found in the secrets list
 *   - kid found but retired (retiredAt non-null and in the past)
 *
 * Errors thrown only for DB outages — caller treats as 'rejected'.
 */
export async function resolveTelemetrySecret(args: {
  licenseId: string;
  kid: string;
}): Promise<ResolvedSecret | null> {
  const license = await db.query.issuedLicenses.findFirst({
    where: eq(issuedLicenses.licenseId, args.licenseId),
  });
  if (!license) return null;
  const cfg = extractTelemetryConfig(license.payloadJson);
  if (!cfg.secrets || cfg.secrets.length === 0) return null;
  const now = Date.now();
  const match = cfg.secrets.find((s) => s.kid === args.kid);
  if (!match) return null;
  if (match.retiredAt) {
    const retired = Date.parse(match.retiredAt);
    if (!Number.isNaN(retired) && retired <= now) return null;
  }
  return { secret: match.secret, kid: match.kid };
}

function extractTelemetryConfig(payloadJson: unknown): TelemetryConfig {
  if (!payloadJson || typeof payloadJson !== 'object') return {};
  const telemetry = (payloadJson as Record<string, unknown>).telemetry;
  if (!telemetry || typeof telemetry !== 'object') return {};
  const secretsRaw = (telemetry as Record<string, unknown>).secrets;
  if (!Array.isArray(secretsRaw)) return {};
  const secrets: StoredSecret[] = [];
  for (const item of secretsRaw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.kid !== 'string' || typeof o.secret !== 'string') continue;
    if (typeof o.activatedAt !== 'string') continue;
    secrets.push({
      kid: o.kid,
      secret: o.secret,
      activatedAt: o.activatedAt,
      retiredAt: typeof o.retiredAt === 'string' ? o.retiredAt : undefined,
    });
  }
  return { secrets };
}

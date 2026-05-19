// SaaS-side resolver for per-license telemetry HMAC secrets.
//
// Storage model: secrets live alongside the IssuedLicense row in
// `payload_json.telemetry.secrets`, an array shaped:
//
//   {
//     kid: string,           // signature key id, e.g. "default"
//     activatedAt: string,
//     retiredAt?: string,
//
//     // exactly one of the following:
//     secret?: string,                            // legacy plaintext (pre-J3)
//     v?: 1, alg?, kekKid?, iv?, ct?, tag?       // J3+ envelope
//   }
//
// The signing flow creates one entry with kid="default" at sign time.
// Future rotation appends new entries; retired entries get retiredAt set
// and become unusable.
//
// J3 (envelope encryption at rest):
//   The shape on disk is `WrappedSecret` (see envelope.ts). At resolve
//   time we unwrap with the SaaS KEK and return plaintext to the HMAC
//   verifier. Decrypt failure returns null which makes ingest reject
//   the upload — fail-closed, no plaintext fallback.
//
// Legacy plaintext rows continue to resolve until the J3 migration
// script (rewrap-telemetry-secrets.ts) has run; afterwards the legacy
// branch is dead.

/* @deployment-mode-hot-gate
 * reason: secret resolver is SaaS-only — on-prem never holds other
 *         customers' secrets. Marker prevents accidental import.
 */

import { eq } from 'drizzle-orm';
import { db, issuedLicenses } from '@/lib/prisma';
import {
  isWrappedSecret,
  unwrapWrappedSecret,
  type WrappedSecret,
} from '@/lib/telemetry/envelope';

export interface ResolvedSecret {
  /** Active secret bytes (utf8) for HMAC. */
  secret: string;
  /** Audit fields — echoed in the persisted telemetry row. */
  kid: string;
}

interface StoredSecret {
  kid: string;
  activatedAt: string;
  retiredAt?: string;
  /** Pre-J3 plaintext shape. */
  secret?: string;
  /** J3+ envelope fields (carried inline alongside kid/activatedAt). */
  wrapped?: WrappedSecret;
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
 *   - envelope present but unwrap fails (tamper / wrong KEK / corrupt)
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

  let plaintext: string | null = null;
  if (match.wrapped) {
    try {
      plaintext = unwrapWrappedSecret(match.wrapped);
    } catch (err) {
      // Fail-closed: log + return null so ingest rejects the upload as
      // 'rejected'. We do NOT fall through to a legacy plaintext copy
      // even if `match.secret` is set, because mixing both fields is a
      // signal of corruption / partial migration.
      console.error('[telemetry/secret-store] envelope decrypt failed', {
        licenseId: args.licenseId,
        kid: args.kid,
        kekKid: match.wrapped.kekKid,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  } else if (typeof match.secret === 'string') {
    plaintext = match.secret;
  }
  if (plaintext === null) return null;
  return { secret: plaintext, kid: match.kid };
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
    if (typeof o.kid !== 'string' || typeof o.activatedAt !== 'string') continue;
    const entry: StoredSecret = {
      kid: o.kid,
      activatedAt: o.activatedAt,
      retiredAt: typeof o.retiredAt === 'string' ? o.retiredAt : undefined,
    };
    if (isWrappedSecret(o)) {
      entry.wrapped = o;
    } else if (typeof o.secret === 'string') {
      entry.secret = o.secret;
    } else {
      // Neither plaintext nor envelope; skip silently — caller treats as
      // "kid not found" which is correct.
      continue;
    }
    secrets.push(entry);
  }
  return { secrets };
}

// Issuer-side helper to mint a fresh telemetry HMAC secret for a new
// license, wrapped under the active KEK before persistence.
//
// Used at every license-creation site (renewal handler + any future
// in-repo signing path). The on-prem cron then signs uploads with the
// plaintext form (delivered out-of-band to the customer at sign time),
// and SaaS ingest unwraps via secret-store.
//
// Why mint a *new* secret on renewal rather than inheriting:
//   - New licenseId → distinct HMAC trust boundary.
//   - Prevents one customer's renewal flow from sharing key material
//     with an unrelated prior license.
//   - Matches the model where each IssuedLicense row owns its own
//     verification material.
//
// The plaintext bytes are returned to the caller exactly once. The
// caller is responsible for shipping the plaintext to the customer
// (e.g. in the renewal email body) and never persisting it. Only the
// envelope lands in payload_json.

/* @deployment-mode-hot-gate
 * reason: SaaS-only. On-prem never mints other customers' secrets;
 *         the on-prem upload path is fed by the customer-provided
 *         ASTER_TELEMETRY_SECRET env, which the SaaS-side issuer set
 *         at sign time.
 */

import { randomBytes } from 'node:crypto';
import { wrapSecret, type WrappedSecret } from '@/lib/telemetry/envelope';

export interface MintedTelemetrySecret {
  /** Plaintext bytes — caller must deliver out-of-band, never persist. */
  plaintext: string;
  /** Persistable envelope (drop into payload_json.telemetry.secrets[]). */
  storedEntry: TelemetryStoredEntry;
}

export interface TelemetryStoredEntry extends WrappedSecret {
  kid: string;
  activatedAt: string;
}

/**
 * Mint a 256-bit HMAC secret encoded as base64url and wrap it under the
 * active KEK. The caller persists `storedEntry` into the new license's
 * `payload_json.telemetry.secrets` array, keyed by `kid` (default
 * "default" — rotation appends new entries with new kids later).
 */
export function mintTelemetrySecret(args: {
  kid?: string;
  activatedAt?: Date;
}): MintedTelemetrySecret {
  const kid = args.kid ?? 'default';
  const activatedAt = (args.activatedAt ?? new Date()).toISOString();
  // 32 bytes of CSPRNG entropy, base64url-encoded → 43 chars. Matches
  // the length license-issue.sh produces (openssl rand -base64 32 with
  // url-safe transform); SaaS-side ingest expects plain utf8 string.
  const plaintext = randomBytes(32).toString('base64url');
  const envelope = wrapSecret(plaintext);
  return {
    plaintext,
    storedEntry: {
      kid,
      activatedAt,
      ...envelope,
    },
  };
}

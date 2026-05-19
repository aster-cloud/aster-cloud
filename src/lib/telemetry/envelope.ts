// SaaS-side envelope encryption for per-license telemetry HMAC secrets.
//
// Storage threat model:
//   The HMAC secrets in IssuedLicense.payload_json.telemetry.secrets[]
//   are what we use to verify telemetry uploads from on-prem deployments
//   (the on-prem cron signs each upload with one of these secrets, and
//   ingest cross-checks). Up through J2 they sat as plaintext utf8
//   strings inside the row's jsonb. A database compromise — backup
//   leak, ops mistake, SQLi reaching admin tables — would hand every
//   customer's HMAC key to the attacker, who could then forge upload
//   reports against any deployment.
//
//   J3 wraps each secret at rest with a Key Encryption Key (KEK) loaded
//   from the SaaS env (ASTER_TELEMETRY_SECRET_KEK). The KEK lives in
//   Vault and is injected as a secret reference; loss of the DB alone
//   no longer compromises customers.
//
// Why not KMS-as-a-service directly:
//   - GCP/AWS KMS keep the KEK inside the cloud HSM but still want a
//     round-trip per wrap/unwrap. The hot path here (ingest auth) does
//     unwrap on every accepted upload — adding a network call per
//     telemetry POST would balloon SaaS p99.
//   - Envelope encryption is the standard pattern: KEK wraps a DEK,
//     DEK encrypts data. For secrets short enough to be their own DEK
//     we degenerate to "KEK wraps the secret bytes directly" which is
//     functionally equivalent to AWS Encryption SDK's GenerateDataKey
//     with a tiny payload.
//   - Migrating to actual KMS later is a swap of `loadKek()` + adding
//     a kekKid lookup; the on-disk envelope shape is forward-compatible
//     (v field bumps).
//
// Envelope format (v=1):
//   {
//     v: 1,
//     alg: 'AES-256-GCM',
//     kekKid: string,        // e.g. 'kek-2026-05'; lets us rotate
//     iv: base64,            // 12 bytes (96-bit, GCM standard)
//     ct: base64,            // ciphertext
//     tag: base64,           // 16 bytes (128-bit auth tag)
//   }
//
// Tampering: any byte change in ct/iv/tag → decrypt throws. We
// deliberately do not return a "best effort" plaintext — secret-store
// treats decrypt failure as "secret unavailable" which fails closed
// (telemetry ingest rejects the upload).
//
// Plaintext compatibility:
//   isWrappedSecret() and unwrapSecret() recognize legacy plaintext
//   shapes ({ secret: string } without ct/iv/tag fields) so we can
//   roll out without simultaneously rewriting every existing row.
//   The migration script (scripts/rewrap-telemetry-secrets.ts) walks
//   the table once and replaces plaintext entries with v=1 envelopes;
//   after that the legacy branch is dead and could be removed in J5.

/* @deployment-mode-hot-gate
 * reason: KEK + plaintext HMAC bytes are SaaS-only. On-prem builds
 *         never possess other customers' secrets and never need to
 *         unwrap them. Marker prevents accidental import into the
 *         on-prem bundle (verify-on-prem-bundle also enforces the
 *         ASTER_TELEMETRY_SECRET_KEK env literal forbidden).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface WrappedSecret {
  v: 1;
  alg: 'AES-256-GCM';
  kekKid: string;
  iv: string;
  ct: string;
  tag: string;
}

export interface LegacyPlaintextSecret {
  /** Pre-J3 shape — raw utf8 bytes. */
  secret: string;
}

export type StoredSecretValue = WrappedSecret | LegacyPlaintextSecret;

/** Distinguish wrapped envelopes from legacy plaintext at runtime. */
export function isWrappedSecret(value: unknown): value is WrappedSecret {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    o.v === 1 &&
    o.alg === 'AES-256-GCM' &&
    typeof o.kekKid === 'string' &&
    typeof o.iv === 'string' &&
    typeof o.ct === 'string' &&
    typeof o.tag === 'string'
  );
}

// ───────── KEK loading ─────────

/**
 * KEK material is supplied via `ASTER_TELEMETRY_SECRET_KEK` as either:
 *   - 64 hex chars (32 raw bytes), or
 *   - base64 of 32 raw bytes.
 *
 * The companion `ASTER_TELEMETRY_SECRET_KEK_KID` is an opaque label
 * (e.g. 'kek-2026-05') stamped into the envelope so a rotation event
 * leaves old envelopes unwrappable with the new key. During rotation
 * ops sets `ASTER_TELEMETRY_SECRET_KEK_PRIOR` + `_PRIOR_KID` so unwrap
 * can fall back to the previous KEK while rewrap migrates rows.
 */
interface KekMaterial {
  key: Buffer;
  kid: string;
}

let _kekCache: { active: KekMaterial; prior?: KekMaterial } | null = null;

export function loadKekFromEnv(): { active: KekMaterial; prior?: KekMaterial } {
  if (_kekCache) return _kekCache;

  const rawActive = process.env.ASTER_TELEMETRY_SECRET_KEK?.trim();
  const kidActive = process.env.ASTER_TELEMETRY_SECRET_KEK_KID?.trim();
  if (!rawActive || !kidActive) {
    throw new Error(
      '[telemetry/envelope] ASTER_TELEMETRY_SECRET_KEK + ASTER_TELEMETRY_SECRET_KEK_KID must be set on SaaS',
    );
  }
  const active: KekMaterial = { key: parseKekBytes(rawActive), kid: kidActive };

  let prior: KekMaterial | undefined;
  const rawPrior = process.env.ASTER_TELEMETRY_SECRET_KEK_PRIOR?.trim();
  const kidPrior = process.env.ASTER_TELEMETRY_SECRET_KEK_PRIOR_KID?.trim();
  if (rawPrior && kidPrior) {
    prior = { key: parseKekBytes(rawPrior), kid: kidPrior };
  }

  _kekCache = { active, prior };
  return _kekCache;
}

function parseKekBytes(raw: string): Buffer {
  // hex (32 bytes = 64 chars) first
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  // else base64; expect 32 bytes after decode
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      '[telemetry/envelope] KEK must decode to exactly 32 bytes (AES-256). Got ' + buf.length,
    );
  }
  return buf;
}

/** @internal — test reset. */
export function __resetKekCacheForTests(): void {
  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    throw new Error('__resetKekCacheForTests called outside test runtime');
  }
  _kekCache = null;
}

// ───────── Wrap / Unwrap ─────────

/**
 * Wrap a plaintext secret string under the *active* KEK. Caller persists
 * the returned envelope verbatim into IssuedLicense.payload_json.telemetry.
 */
export function wrapSecret(plaintext: string): WrappedSecret {
  const { active } = loadKekFromEnv();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', active.key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'AES-256-GCM',
    kekKid: active.kid,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Unwrap a stored envelope. Tries the active KEK first, then the prior
 * KEK (set during rotation). Throws on:
 *   - kekKid mismatch with all configured KEKs
 *   - GCM auth tag verification failure (tamper or wrong key)
 *   - any field malformed (base64 decode failure, wrong iv length, etc.)
 *
 * Caller (secret-store) catches and returns null — telemetry ingest
 * then rejects the upload as if the secret didn't exist. We never
 * fall through to plaintext or partial decrypt.
 */
export function unwrapWrappedSecret(env: WrappedSecret): string {
  const { active, prior } = loadKekFromEnv();
  const candidates: KekMaterial[] = [];
  if (env.kekKid === active.kid) candidates.push(active);
  if (prior && env.kekKid === prior.kid) candidates.push(prior);
  if (candidates.length === 0) {
    throw new Error(
      `[telemetry/envelope] envelope kekKid="${env.kekKid}" not in active+prior KEKs`,
    );
  }

  const iv = Buffer.from(env.iv, 'base64');
  const ct = Buffer.from(env.ct, 'base64');
  const tag = Buffer.from(env.tag, 'base64');
  if (iv.length !== 12) {
    throw new Error('[telemetry/envelope] iv length must be 12 bytes (GCM)');
  }
  if (tag.length !== 16) {
    throw new Error('[telemetry/envelope] auth tag length must be 16 bytes');
  }

  // Try each candidate; on a rotation overlap window the same kid
  // shouldn't appear twice so this loop typically runs once.
  let lastErr: unknown;
  for (const kek of candidates) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', kek.key, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('[telemetry/envelope] decrypt failed (no candidate succeeded)');
}

/**
 * Accept either shape and return plaintext. Returns null when the
 * value can't be coerced (caller treats as "no secret"). Decrypt
 * failure is propagated as throw so secret-store can log + reject.
 */
export function unwrapSecret(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  if (isWrappedSecret(value)) return unwrapWrappedSecret(value);
  const o = value as Record<string, unknown>;
  if (typeof o.secret === 'string') return o.secret;
  return null;
}

// Envelope (J3) unit tests — round-trip, tamper, rotation, malformed.
//
// These run in the saas vitest project (envelope is SaaS-only) but
// only exercise the pure crypto path; no DB needed.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  __resetKekCacheForTests,
  isWrappedSecret,
  loadKekFromEnv,
  unwrapSecret,
  unwrapWrappedSecret,
  wrapSecret,
} from '@/lib/telemetry/envelope';

const ENV_KEYS = [
  'ASTER_TELEMETRY_SECRET_KEK',
  'ASTER_TELEMETRY_SECRET_KEK_KID',
  'ASTER_TELEMETRY_SECRET_KEK_PRIOR',
  'ASTER_TELEMETRY_SECRET_KEK_PRIOR_KID',
] as const;
const saved = new Map<string, string | undefined>();

function setKek(active: { key: string; kid: string }, prior?: { key: string; kid: string }) {
  process.env.ASTER_TELEMETRY_SECRET_KEK = active.key;
  process.env.ASTER_TELEMETRY_SECRET_KEK_KID = active.kid;
  if (prior) {
    process.env.ASTER_TELEMETRY_SECRET_KEK_PRIOR = prior.key;
    process.env.ASTER_TELEMETRY_SECRET_KEK_PRIOR_KID = prior.kid;
  } else {
    delete process.env.ASTER_TELEMETRY_SECRET_KEK_PRIOR;
    delete process.env.ASTER_TELEMETRY_SECRET_KEK_PRIOR_KID;
  }
  __resetKekCacheForTests();
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved.set(k, process.env[k]);
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetKekCacheForTests();
});

const KEK_A_HEX = randomBytes(32).toString('hex');
const KEK_B_HEX = randomBytes(32).toString('hex');

describe('envelope: wrap/unwrap roundtrip', () => {
  it('roundtrips a typical 32-byte base64url HMAC secret', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-test-A' });
    const plain = randomBytes(32).toString('base64url');
    const env = wrapSecret(plain);
    expect(env.v).toBe(1);
    expect(env.alg).toBe('AES-256-GCM');
    expect(env.kekKid).toBe('kek-test-A');
    expect(unwrapWrappedSecret(env)).toBe(plain);
  });

  it('produces fresh iv on each wrap (no IV reuse)', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-test-A' });
    const plain = 'same-plaintext';
    const e1 = wrapSecret(plain);
    const e2 = wrapSecret(plain);
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.ct).not.toBe(e2.ct);
  });

  it('accepts KEK as base64 in addition to hex', () => {
    const kekRaw = randomBytes(32);
    process.env.ASTER_TELEMETRY_SECRET_KEK = kekRaw.toString('base64');
    process.env.ASTER_TELEMETRY_SECRET_KEK_KID = 'kek-b64';
    __resetKekCacheForTests();
    const env = wrapSecret('hello');
    expect(unwrapWrappedSecret(env)).toBe('hello');
  });
});

describe('envelope: tamper detection (GCM auth tag)', () => {
  it('rejects ciphertext mutation', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('payload-bytes');
    const ctBytes = Buffer.from(env.ct, 'base64');
    ctBytes[0] ^= 0xff;
    const tampered = { ...env, ct: ctBytes.toString('base64') };
    expect(() => unwrapWrappedSecret(tampered)).toThrow();
  });

  it('rejects iv mutation', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('payload-bytes');
    const ivBytes = Buffer.from(env.iv, 'base64');
    ivBytes[0] ^= 0xff;
    const tampered = { ...env, iv: ivBytes.toString('base64') };
    expect(() => unwrapWrappedSecret(tampered)).toThrow();
  });

  it('rejects tag mutation', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('payload-bytes');
    const tagBytes = Buffer.from(env.tag, 'base64');
    tagBytes[0] ^= 0xff;
    const tampered = { ...env, tag: tagBytes.toString('base64') };
    expect(() => unwrapWrappedSecret(tampered)).toThrow();
  });
});

describe('envelope: KEK rotation', () => {
  it('unwraps an envelope under the prior KEK after rotation', () => {
    // Wrap under A.
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('rotated-secret');

    // Rotate: B becomes active, A demoted to prior.
    setKek({ key: KEK_B_HEX, kid: 'kek-B' }, { key: KEK_A_HEX, kid: 'kek-A' });
    expect(unwrapWrappedSecret(env)).toBe('rotated-secret');
  });

  it('rejects an envelope whose kekKid is in neither active nor prior', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('payload');
    const orphan = { ...env, kekKid: 'kek-deleted' };
    expect(() => unwrapWrappedSecret(orphan)).toThrow(/kekKid.*not in active\+prior/);
  });

  it('wraps under the new active KEK after rotation, not the old one', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    setKek({ key: KEK_B_HEX, kid: 'kek-B' }, { key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('written-after-rotation');
    expect(env.kekKid).toBe('kek-B');
  });
});

describe('envelope: malformed input', () => {
  it('rejects non-12-byte iv', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('x');
    const bad = { ...env, iv: Buffer.alloc(8).toString('base64') };
    expect(() => unwrapWrappedSecret(bad)).toThrow(/iv length/);
  });

  it('rejects non-16-byte auth tag', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('x');
    const bad = { ...env, tag: Buffer.alloc(8).toString('base64') };
    expect(() => unwrapWrappedSecret(bad)).toThrow(/auth tag length/);
  });

  it('refuses to load KEK when env is unset', () => {
    delete process.env.ASTER_TELEMETRY_SECRET_KEK;
    delete process.env.ASTER_TELEMETRY_SECRET_KEK_KID;
    __resetKekCacheForTests();
    expect(() => loadKekFromEnv()).toThrow(/must be set on SaaS/);
  });

  it('refuses KEK that does not decode to 32 bytes', () => {
    process.env.ASTER_TELEMETRY_SECRET_KEK = 'too-short';
    process.env.ASTER_TELEMETRY_SECRET_KEK_KID = 'kek-bad';
    __resetKekCacheForTests();
    expect(() => loadKekFromEnv()).toThrow(/32 bytes/);
  });
});

describe('envelope: shape predicates + unwrapSecret coercion', () => {
  it('isWrappedSecret returns true only for v=1 envelopes', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('x');
    expect(isWrappedSecret(env)).toBe(true);
    expect(isWrappedSecret({ secret: 'plaintext' })).toBe(false);
    expect(isWrappedSecret({ v: 2, alg: 'AES-256-GCM' })).toBe(false);
    expect(isWrappedSecret(null)).toBe(false);
    expect(isWrappedSecret('string')).toBe(false);
  });

  it('unwrapSecret returns plaintext for envelope', () => {
    setKek({ key: KEK_A_HEX, kid: 'kek-A' });
    const env = wrapSecret('round-trip');
    expect(unwrapSecret(env)).toBe('round-trip');
  });

  it('unwrapSecret returns plaintext for legacy {secret} shape', () => {
    expect(unwrapSecret({ secret: 'legacy' })).toBe('legacy');
  });

  it('unwrapSecret returns null for unrecognized shapes', () => {
    expect(unwrapSecret({})).toBeNull();
    expect(unwrapSecret(null)).toBeNull();
    expect(unwrapSecret(42)).toBeNull();
  });
});

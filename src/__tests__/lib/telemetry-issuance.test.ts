// mintTelemetrySecret (J3) unit tests — shape of the persisted entry +
// roundtrip via the same KEK.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mintTelemetrySecret } from '@/lib/telemetry/issuance';
import {
  __resetKekCacheForTests,
  unwrapWrappedSecret,
} from '@/lib/telemetry/envelope';

const KEK_HEX = randomBytes(32).toString('hex');
let prevKek: string | undefined;
let prevKekKid: string | undefined;

beforeEach(() => {
  prevKek = process.env.ASTER_TELEMETRY_SECRET_KEK;
  prevKekKid = process.env.ASTER_TELEMETRY_SECRET_KEK_KID;
  process.env.ASTER_TELEMETRY_SECRET_KEK = KEK_HEX;
  process.env.ASTER_TELEMETRY_SECRET_KEK_KID = 'kek-iss';
  __resetKekCacheForTests();
});
afterEach(() => {
  if (prevKek === undefined) delete process.env.ASTER_TELEMETRY_SECRET_KEK;
  else process.env.ASTER_TELEMETRY_SECRET_KEK = prevKek;
  if (prevKekKid === undefined) delete process.env.ASTER_TELEMETRY_SECRET_KEK_KID;
  else process.env.ASTER_TELEMETRY_SECRET_KEK_KID = prevKekKid;
  __resetKekCacheForTests();
});

describe('mintTelemetrySecret', () => {
  it('returns plaintext + envelope that decrypts back to plaintext', () => {
    const minted = mintTelemetrySecret({});
    expect(minted.plaintext).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(unwrapWrappedSecret(minted.storedEntry)).toBe(minted.plaintext);
  });

  it('embeds kid="default" + activatedAt by default', () => {
    const before = Date.now();
    const minted = mintTelemetrySecret({});
    const after = Date.now();
    expect(minted.storedEntry.kid).toBe('default');
    const t = Date.parse(minted.storedEntry.activatedAt);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('honors override kid + activatedAt', () => {
    const at = new Date('2026-01-15T10:00:00.000Z');
    const minted = mintTelemetrySecret({ kid: 'rot-2026-01', activatedAt: at });
    expect(minted.storedEntry.kid).toBe('rot-2026-01');
    expect(minted.storedEntry.activatedAt).toBe('2026-01-15T10:00:00.000Z');
  });

  it('produces distinct plaintexts across calls', () => {
    const a = mintTelemetrySecret({});
    const b = mintTelemetrySecret({});
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.storedEntry.ct).not.toBe(b.storedEntry.ct);
  });

  it('storedEntry is shape-compatible with secret-store: kid + envelope fields', () => {
    const minted = mintTelemetrySecret({ kid: 'default' });
    const e = minted.storedEntry;
    expect(e.v).toBe(1);
    expect(e.alg).toBe('AES-256-GCM');
    expect(typeof e.kekKid).toBe('string');
    expect(typeof e.iv).toBe('string');
    expect(typeof e.ct).toBe('string');
    expect(typeof e.tag).toBe('string');
    // legacy `secret` field must be absent — caller persists envelope only
    expect((e as unknown as Record<string, unknown>).secret).toBeUndefined();
  });
});

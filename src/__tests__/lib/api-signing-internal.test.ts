import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { signInternalCallerHeaders } from '@/lib/api-signing';

describe('signInternalCallerHeaders', () => {
  const originalKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;

  beforeEach(() => {
    process.env.ASTER_PLAN_GATE_HMAC_KEY = 'test-internal-caller-secret-32chars';
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
  });

  it('returns 3 headers with cloud-bff caller', async () => {
    const h = await signInternalCallerHeaders('POST', '/api/v1/policies/evaluate-source');
    expect(h['X-Internal-Caller']).toBe('cloud-bff');
    expect(h['X-Aster-Timestamp']).toMatch(/^\d+$/);
    expect(h['X-Internal-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature matches Node crypto baseline', async () => {
    const path = '/api/v1/policies/evaluate-source';
    const h = await signInternalCallerHeaders('POST', path);
    const expected = createHmac('sha256', 'test-internal-caller-secret-32chars')
      .update(`POST\n${path}\n${h['X-Aster-Timestamp']}`)
      .digest('hex');
    expect(h['X-Internal-Signature']).toBe(expected);
  });

  it('different path → different signature', async () => {
    const a = await signInternalCallerHeaders('POST', '/path/a');
    const b = await signInternalCallerHeaders('POST', '/path/b');
    expect(a['X-Internal-Signature']).not.toBe(b['X-Internal-Signature']);
  });

  it('throws when key missing', async () => {
    delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    await expect(signInternalCallerHeaders('POST', '/x')).rejects.toThrow(
      /ASTER_PLAN_GATE_HMAC_KEY/
    );
  });

  it('timestamp is unix-seconds format', async () => {
    const before = Math.floor(Date.now() / 1000);
    const h = await signInternalCallerHeaders('POST', '/x');
    const after = Math.floor(Date.now() / 1000);
    const ts = parseInt(h['X-Aster-Timestamp'], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });
});

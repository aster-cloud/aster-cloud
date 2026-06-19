import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { signLexiconAdminHeaders } from '@/lib/api-signing';

/**
 * 锁住 signLexiconAdminHeaders 的 canonical 与后端 LexiconAdminResource.verifyHmac
 * **逐字节一致**。后端 canonical（disable/enable：无 body/filename）：
 *
 *   method\npath\nts\nnonce\n(ct="")\n(len=0)\n(sha="")\n(fn="")
 *
 * 任何格式漂移都会让后端静默返回 403 invalid_signature——这个测试是该契约的守门人。
 */
function backendCanonical(
  method: string,
  path: string,
  ts: string,
  nonce: string,
): string {
  // 与 Java 端 8 行拼接对齐：ct/sha/fn 空、len=0。
  return [method, path, ts, nonce, '', '0', '', ''].join('\n');
}

describe('signLexiconAdminHeaders', () => {
  const originalKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  const SECRET = 'test-lexicon-admin-secret-32chars!!';

  beforeEach(() => {
    process.env.ASTER_PLAN_GATE_HMAC_KEY = SECRET;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
  });

  it('returns the 3 headers backend verifyHmac requires', async () => {
    const h = await signLexiconAdminHeaders(
      'POST',
      '/api/v1/admin/lexicons/de-DE/disable',
    );
    expect(h['X-Aster-Timestamp']).toMatch(/^\d+$/);
    expect(h['X-Aster-Nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(h['X-Internal-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signature matches backend 8-line canonical baseline', async () => {
    const path = '/api/v1/admin/lexicons/de-DE/disable';
    const h = await signLexiconAdminHeaders('POST', path);
    const expected = createHmac('sha256', SECRET)
      .update(backendCanonical('POST', path, h['X-Aster-Timestamp'], h['X-Aster-Nonce']))
      .digest('hex');
    expect(h['X-Internal-Signature']).toBe(expected);
  });

  it('enable and disable paths produce distinct signatures', async () => {
    const a = await signLexiconAdminHeaders('POST', '/api/v1/admin/lexicons/zh-CN/enable');
    const b = await signLexiconAdminHeaders('POST', '/api/v1/admin/lexicons/zh-CN/disable');
    expect(a['X-Internal-Signature']).not.toBe(b['X-Internal-Signature']);
  });

  it('nonce is unique across calls (replay protection)', async () => {
    const a = await signLexiconAdminHeaders('POST', '/api/v1/admin/lexicons/de-DE/disable');
    const b = await signLexiconAdminHeaders('POST', '/api/v1/admin/lexicons/de-DE/disable');
    expect(a['X-Aster-Nonce']).not.toBe(b['X-Aster-Nonce']);
  });

  it('timestamp is unix-seconds (backend compares 5min skew in seconds)', async () => {
    const before = Math.floor(Date.now() / 1000);
    const h = await signLexiconAdminHeaders('POST', '/api/v1/admin/lexicons/de-DE/disable');
    const after = Math.floor(Date.now() / 1000);
    const ts = parseInt(h['X-Aster-Timestamp'], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });

  it('throws when key missing', async () => {
    delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    await expect(
      signLexiconAdminHeaders('POST', '/api/v1/admin/lexicons/de-DE/disable'),
    ).rejects.toThrow(/ASTER_PLAN_GATE_HMAC_KEY/);
  });
});

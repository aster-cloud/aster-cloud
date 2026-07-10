import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { signByokAllowlistHeaders } from '@/lib/api-signing';

/**
 * 锁住 signByokAllowlistHeaders 的 canonical 与后端 AdminHmacVerifier **逐字节一致**。
 * 后端 canonical（7 段，含 body sha256）：
 *
 *   method\npath\nts\nnonce\ncontentType\ncontentLength\nbodySha256
 *
 * 任何漂移都会让后端 403 invalid_signature → BYOK allowlist 管理端点完全不工作。
 * 这个测试是该契约的守门人。
 */
function backendCanonical(
  method: string,
  path: string,
  ts: string,
  nonce: string,
  contentType: string,
  contentLength: number,
  bodySha256: string,
): string {
  return [method, path, ts, nonce, contentType, String(contentLength), bodySha256].join('\n');
}

const PATH = '/api/v1/admin/byok-allowlist';

describe('signByokAllowlistHeaders', () => {
  const originalKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  const SECRET = 'test-byok-allowlist-secret-32chars!!';

  beforeEach(() => {
    process.env.ASTER_PLAN_GATE_HMAC_KEY = SECRET;
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
  });

  it('returns the 3 headers backend AdminHmacVerifier requires', async () => {
    const h = await signByokAllowlistHeaders('GET', PATH, null);
    expect(h['X-Aster-Timestamp']).toMatch(/^\d+$/);
    expect(h['X-Aster-Nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(h['X-Internal-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GET signature matches backend canonical (ct="", len=0, sha="")', async () => {
    const h = await signByokAllowlistHeaders('GET', PATH, null);
    const expected = createHmac('sha256', SECRET)
      .update(backendCanonical('GET', PATH, h['X-Aster-Timestamp'], h['X-Aster-Nonce'], '', 0, ''))
      .digest('hex');
    expect(h['X-Internal-Signature']).toBe(expected);
  });

  it('POST signature matches backend canonical (ct=application/json, len=bytes, sha=body)', async () => {
    const body = JSON.stringify({ action: 'add', host: 'gateway.example.com' });
    const h = await signByokAllowlistHeaders('POST', PATH, body);
    const bytes = new TextEncoder().encode(body);
    const bodySha = createHash('sha256').update(bytes).digest('hex');
    const expected = createHmac('sha256', SECRET)
      .update(
        backendCanonical(
          'POST', PATH, h['X-Aster-Timestamp'], h['X-Aster-Nonce'],
          'application/json', bytes.length, bodySha,
        ),
      )
      .digest('hex');
    expect(h['X-Internal-Signature']).toBe(expected);
  });

  it('POST content-length is UTF-8 byte length (multibyte host)', async () => {
    // 多字节 host（IDN 已在后端 SsrfGuard 规范化，但 body 传原始字符串时字节数 ≠ 字符数）。
    const body = JSON.stringify({ action: 'add', host: 'gaté.example.com' });
    const bytes = new TextEncoder().encode(body);
    expect(bytes.length).toBeGreaterThan(body.length); // 有多字节
    const h = await signByokAllowlistHeaders('POST', PATH, body);
    const bodySha = createHash('sha256').update(bytes).digest('hex');
    const expected = createHmac('sha256', SECRET)
      .update(
        backendCanonical(
          'POST', PATH, h['X-Aster-Timestamp'], h['X-Aster-Nonce'],
          'application/json', bytes.length, bodySha,
        ),
      )
      .digest('hex');
    expect(h['X-Internal-Signature']).toBe(expected);
  });

  it('throws when HMAC key not configured', async () => {
    delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    await expect(signByokAllowlistHeaders('GET', PATH, null)).rejects.toThrow();
  });
});

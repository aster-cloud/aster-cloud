import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { signInternalCallerHeaders } from '@/lib/api-signing';

const KEY = 'test-internal-caller-secret-32chars';

// 与后端 InternalCallerFilter 逐字节一致的 canonical 重算：
//   method\npath\nts\nnonce\nbodySha256\ntenant\nrole
function expectedSig(
  method: string,
  path: string,
  ts: string,
  nonce: string,
  body: string | undefined,
  tenant: string,
  role: string,
): string {
  const bodyHash = createHash('sha256')
    .update(body ? Buffer.from(body, 'utf8') : Buffer.alloc(0))
    .digest('hex');
  const canonical = `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}\n${tenant}\n${role}`;
  return createHmac('sha256', KEY).update(canonical).digest('hex');
}

describe('signInternalCallerHeaders (红队 P0-C 加固)', () => {
  const originalKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;

  beforeEach(() => {
    process.env.ASTER_PLAN_GATE_HMAC_KEY = KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
  });

  it('返回 cloud-bff 头 + nonce + ts + 签名', async () => {
    const h = await signInternalCallerHeaders('POST', '/api/v1/policies/evaluate-source');
    expect(h['X-Internal-Caller']).toBe('cloud-bff');
    expect(h['X-Aster-Timestamp']).toMatch(/^\d+$/);
    expect(h['X-Aster-Nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(h['X-Internal-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('签名与后端 7 行 canonical 基线一致（含 body/tenant/role）', async () => {
    const path = '/api/v1/ai/complete';
    const body = '{"model":"cheap","prompt":"hi"}';
    const tenant = 'tenant-42';
    const role = 'MEMBER';
    const h = await signInternalCallerHeaders('POST', path, body, tenant, role);
    const expected = expectedSig(
      'POST', path, h['X-Aster-Timestamp'], h['X-Aster-Nonce'], body, tenant, role,
    );
    expect(h['X-Internal-Signature']).toBe(expected);
  });

  it('空 body/tenant/role 时按空字符串签（与后端一致）', async () => {
    const path = '/api/v1/policies/evaluate-source';
    const h = await signInternalCallerHeaders('POST', path);
    const expected = expectedSig(
      'POST', path, h['X-Aster-Timestamp'], h['X-Aster-Nonce'], undefined, '', '',
    );
    expect(h['X-Internal-Signature']).toBe(expected);
  });

  it('改 body → 签名变（防换 LLM model 烧预算）', async () => {
    const path = '/api/v1/ai/complete';
    const a = await signInternalCallerHeaders('POST', path, '{"model":"cheap"}', 't', '');
    // 相同 ts/nonce 不可控，故用基线重算隔离 body 变量
    const sigCheap = expectedSig('POST', path, a['X-Aster-Timestamp'], a['X-Aster-Nonce'], '{"model":"cheap"}', 't', '');
    const sigPricey = expectedSig('POST', path, a['X-Aster-Timestamp'], a['X-Aster-Nonce'], '{"model":"pricey"}', 't', '');
    expect(a['X-Internal-Signature']).toBe(sigCheap);
    expect(sigCheap).not.toBe(sigPricey);
  });

  it('改 tenant → 签名变（防跨租户假冒）', async () => {
    const path = '/api/v1/policies/evaluate-source';
    const h = await signInternalCallerHeaders('POST', path, 'body', 'tenant-a', '');
    const sameTenant = expectedSig('POST', path, h['X-Aster-Timestamp'], h['X-Aster-Nonce'], 'body', 'tenant-a', '');
    const otherTenant = expectedSig('POST', path, h['X-Aster-Timestamp'], h['X-Aster-Nonce'], 'body', 'tenant-b', '');
    expect(h['X-Internal-Signature']).toBe(sameTenant);
    expect(sameTenant).not.toBe(otherTenant);
  });

  it('改 role → 签名变（防提权）', async () => {
    const path = '/api/v1/policies/evaluate-source';
    const h = await signInternalCallerHeaders('POST', path, 'body', 't', 'MEMBER');
    const asMember = expectedSig('POST', path, h['X-Aster-Timestamp'], h['X-Aster-Nonce'], 'body', 't', 'MEMBER');
    const asAdmin = expectedSig('POST', path, h['X-Aster-Timestamp'], h['X-Aster-Nonce'], 'body', 't', 'ADMIN');
    expect(h['X-Internal-Signature']).toBe(asMember);
    expect(asMember).not.toBe(asAdmin);
  });

  it('每次 nonce 唯一（防重放）', async () => {
    const a = await signInternalCallerHeaders('POST', '/x');
    const b = await signInternalCallerHeaders('POST', '/x');
    expect(a['X-Aster-Nonce']).not.toBe(b['X-Aster-Nonce']);
    expect(a['X-Internal-Signature']).not.toBe(b['X-Internal-Signature']);
  });

  it('不同 path → 不同签名', async () => {
    const a = await signInternalCallerHeaders('POST', '/path/a');
    const b = await signInternalCallerHeaders('POST', '/path/b');
    expect(a['X-Internal-Signature']).not.toBe(b['X-Internal-Signature']);
  });

  it('缺 key 时抛错', async () => {
    delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    await expect(signInternalCallerHeaders('POST', '/x')).rejects.toThrow(
      /ASTER_PLAN_GATE_HMAC_KEY/
    );
  });

  it('timestamp 是 unix 秒', async () => {
    const before = Math.floor(Date.now() / 1000);
    const h = await signInternalCallerHeaders('POST', '/x');
    const after = Math.floor(Date.now() / 1000);
    const ts = parseInt(h['X-Aster-Timestamp'], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });
});

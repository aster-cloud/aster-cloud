import { describe, it, expect } from 'vitest';
import { createHmac, createHash } from 'node:crypto';
import { verifyInternalSignature } from '../api-signing';

/**
 * `/api/internal/*` 入站验签契约（2026-07-29 审计修复）。
 *
 * 缺陷：8 个内部路由各自手写验签，canonical 一律 `method\npath\ntimestamp`
 * ——不绑定 body、不绑定 query、无 nonce。攻击者拿到任意一次签名（代理日志、
 * SSRF、镜像流量），即可在 300s 窗口内**换掉 body 无限重放**：打
 * /api/internal/api/usage 可为任意 userId 伪造用量、篡改计费归属。
 *
 * 出站签名器早已加固为多字段 canonical——加固只做了发送侧，接收侧从未同步。
 */

const SECRET = 'test-secret-key';
const PATH = '/api/internal/api/usage';
const BODY = '{"userId":"u1"}';

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmacHex = (data: string) => createHmac('sha256', SECRET).update(data, 'utf8').digest('hex');
const now = () => Math.floor(Date.now() / 1000);

function makeReq(headers: Record<string, string>, body = BODY, method = 'POST') {
  return new Request(`https://x.test${PATH}`, {
    method,
    body: method === 'GET' ? undefined : body,
    headers,
  });
}

/** v2：method\npath\nts\nnonce\nbodyHash —— 与 Java InternalCallSigner 逐字对齐 */
function v2(ts: number, nonce: string, body: string) {
  return hmacHex(`POST\n${PATH}\n${ts}\n${nonce}\n${sha256Hex(body)}`);
}
/** v1（旧）：method\npath\nts */
const v1 = (ts: number) => hmacHex(`POST\n${PATH}\n${ts}`);

describe('verifyInternalSignature', () => {
  it('v2 签名通过，且标记 usedLegacyCanonical=false', async () => {
    const ts = now(), nonce = 'n-1';
    const r = await verifyInternalSignature(
      makeReq({ 'X-Aster-Timestamp': String(ts), 'X-Aster-Nonce': nonce, 'X-Internal-Signature': v2(ts, nonce, BODY) }),
      BODY, SECRET);
    expect(r).toEqual({ ok: true, usedLegacyCanonical: false });
  });

  it('★换 body 重放：v2 下必须拒绝（这是本次修复的核心）', async () => {
    const ts = now(), nonce = 'n-1';
    const sig = v2(ts, nonce, BODY);           // 对原始 body 的合法签名
    const tampered = '{"userId":"victim"}';    // 攻击者换掉 body
    const r = await verifyInternalSignature(
      makeReq({ 'X-Aster-Timestamp': String(ts), 'X-Aster-Nonce': nonce, 'X-Internal-Signature': sig }, tampered),
      tampered, SECRET, { allowLegacy: false });
    expect(r.ok).toBe(false);
  });

  it('迁移窗口内接受 v1，并标记 usedLegacyCanonical=true（用于观测切换进度）', async () => {
    const ts = now();
    const r = await verifyInternalSignature(
      makeReq({ 'X-Aster-Timestamp': String(ts), 'X-Aster-Signature': v1(ts) }),
      BODY, SECRET, { allowLegacy: true });
    expect(r).toEqual({ ok: true, usedLegacyCanonical: true });
  });

  it('★关闭兼容后 v1 必须被拒——这是迁移第三步的终态', async () => {
    const ts = now();
    const r = await verifyInternalSignature(
      makeReq({ 'X-Aster-Timestamp': String(ts), 'X-Aster-Signature': v1(ts) }),
      BODY, SECRET, { allowLegacy: false });
    expect(r).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('过期时间戳拒绝（300s 窗口）', async () => {
    const ts = now() - 400, nonce = 'n-1';
    const r = await verifyInternalSignature(
      makeReq({ 'X-Aster-Timestamp': String(ts), 'X-Aster-Nonce': nonce, 'X-Internal-Signature': v2(ts, nonce, BODY) }),
      BODY, SECRET);
    expect(r).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('缺签名头拒绝', async () => {
    const r = await verifyInternalSignature(makeReq({}), BODY, SECRET);
    expect(r).toEqual({ ok: false, reason: 'missing_signature_headers' });
  });

  it('非数字时间戳拒绝（不得落到 NaN 比较）', async () => {
    const r = await verifyInternalSignature(
      makeReq({ 'X-Aster-Timestamp': 'not-a-number', 'X-Internal-Signature': 'ab'.repeat(32) }),
      BODY, SECRET);
    expect(r).toEqual({ ok: false, reason: 'invalid_timestamp' });
  });
});

// P0-A S1：verifyRegressionTransition 单元测试。用 dev regression-transition 私钥真签 manifest → 验签，
// 覆盖 verified / untrusted-key / signature-invalid / manifest-invalid / malformed 全路径。

import { describe, it, expect } from 'vitest';
import { sign as edSign, createPrivateKey } from 'node:crypto';
import { verifyRegressionTransition } from '@/lib/regression-transition-verify';

// 与 __dev-regr-2026-01__ 公钥配对的私钥（PKCS8 PEM）——与 license-trust-bundle DEV_REGR_PUBKEY 同一对。
// ★仅测试用；生产 build 用 Vault 提取的真实公钥替换 dev 条目，私钥永不落盘。
const DEV_REGR_PRIV_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIERdgmfGWeAqshxs4u2OMasCeBryUM+ogO1UYmisfv4c
-----END PRIVATE KEY-----`;

const KEY_ID = '__dev-regr-2026-01__';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// canonical JSON（key 递归排序）——与 signing-api canonicalStringify 对齐。
function canonicalStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify(o[k])}`).join(',')}}`;
}

/** 用 dev 私钥签一个 manifest → 返回 signing-api 形态的 { canonicalPayloadB64url, signatureB64url }。 */
function signManifest(manifest: Record<string, unknown>): { payload: string; sig: string } {
  const canonical = canonicalStringify(manifest);
  const key = createPrivateKey(DEV_REGR_PRIV_PEM);
  // Ed25519 一次性签名：crypto.sign(null, msg, key)（algorithm 必须 null）。
  const sig = edSign(null, Buffer.from(canonical, 'utf8'), key);
  return { payload: b64url(Buffer.from(canonical, 'utf8')), sig: b64url(sig) };
}

const VALID_MANIFEST = {
  schemaVersion: 1,
  purpose: 'regression-transition',
  baselineToolchainId: 'abi=1.0;core=1.0.13;validator=1;build=oldsha',
  currentToolchainId: 'abi=1.0;core=1.0.14;validator=1;build=newsha',
  policyId: 'pol-1',
  approvedBy: 'user-approver',
};

describe('verifyRegressionTransition', () => {
  it('★真签 manifest → verified，返回 manifest + 命中受信 key', async () => {
    const { payload, sig } = signManifest(VALID_MANIFEST);
    const r = await verifyRegressionTransition(KEY_ID, payload, sig);
    expect(r.status).toBe('verified');
    expect(r.manifest?.baselineToolchainId).toBe(VALID_MANIFEST.baselineToolchainId);
    expect(r.manifest?.currentToolchainId).toBe(VALID_MANIFEST.currentToolchainId);
    expect(r.signingKey?.keyId).toBe(KEY_ID);
  });

  it('★不信工件自报 keyId：未知 keyId → untrusted-key（不 fall back 别的信任根）', async () => {
    const { payload, sig } = signManifest(VALID_MANIFEST);
    const r = await verifyRegressionTransition('__dev-lic-2026-01__', payload, sig); // license key，非 regr
    expect(r.status).toBe('untrusted-key');
    expect(r.manifest).toBeNull();
  });

  it('★purpose 隔离：用 license keyId 查 regression-transition → untrusted（purpose 分派信任根）', async () => {
    const { payload, sig } = signManifest(VALID_MANIFEST);
    // 即便 keyId 存在于 bundle（作为 license），regression-transition purpose 查不到 → untrusted。
    const r = await verifyRegressionTransition('__dev-rev-2026-01__', payload, sig);
    expect(r.status).toBe('untrusted-key');
  });

  it('★篡改签名 → signature-invalid', async () => {
    const { payload } = signManifest(VALID_MANIFEST);
    const r = await verifyRegressionTransition(KEY_ID, payload, b64url(Buffer.alloc(64, 7)));
    expect(r.status).toBe('signature-invalid');
    expect(r.manifest).toBeNull();
  });

  it('★篡改 payload（改字节后签名对不上）→ signature-invalid', async () => {
    const { sig } = signManifest(VALID_MANIFEST);
    const tampered = b64url(Buffer.from(canonicalStringify({ ...VALID_MANIFEST, policyId: 'pol-EVIL' }), 'utf8'));
    const r = await verifyRegressionTransition(KEY_ID, tampered, sig);
    expect(r.status).toBe('signature-invalid');
  });

  it('★验签通过但 payload.purpose 非 regression-transition → manifest-invalid（re-assert 协议域）', async () => {
    const { payload, sig } = signManifest({ ...VALID_MANIFEST, purpose: 'license' });
    const r = await verifyRegressionTransition(KEY_ID, payload, sig);
    expect(r.status).toBe('manifest-invalid');
  });

  it('★验签通过但 X===Y（无方向）→ manifest-invalid', async () => {
    const same = 'abi=1.0;core=1.0.14;validator=1;build=x';
    const { payload, sig } = signManifest({ ...VALID_MANIFEST, baselineToolchainId: same, currentToolchainId: same });
    const r = await verifyRegressionTransition(KEY_ID, payload, sig);
    expect(r.status).toBe('manifest-invalid');
  });

  it('★验签通过但缺必需字段 → manifest-invalid', async () => {
    const { policyId: _omit, ...noPolicyId } = VALID_MANIFEST;
    void _omit;
    const { payload, sig } = signManifest(noPolicyId);
    const r = await verifyRegressionTransition(KEY_ID, payload, sig);
    expect(r.status).toBe('manifest-invalid');
  });

  it('★坏 base64url → malformed', async () => {
    const r = await verifyRegressionTransition(KEY_ID, 'not valid base64url!!!', 'also!!!bad');
    expect(r.status).toBe('malformed');
  });
});

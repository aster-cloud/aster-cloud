// license parser 行为：
//   - 空 / undefined → missing
//   - 前缀错 → malformed/prefix-mismatch
//   - base64 错 → malformed/base64-decode-failed
//   - JSON 错 → malformed/json-parse-failed
//   - payload shape 错 → malformed/payload-shape-invalid
//   - expiresAt 过期 → expired，含 daysRemaining < 0
//   - 一切正常 → active
//
// hasLicenseFeature 安全契约（PR-L2 收紧）：
//   - 永远只接受 v2 verified + active 的 LicenseResult
//   - LegacyLicenseResult（v1 parseLicenseKey 返回值）一律 false，因为 v1
//     没有签名保护，features 数组可被 LICENSE_KEY 持有者任意伪造

import { describe, it, expect } from 'vitest';
import {
  parseLicenseKey,
  hasLicenseFeature,
  verifyLicenseKey,
  type LicensePayloadV2,
} from '@/lib/license';
import type { TrustBundleEntry } from '@/lib/license-trust-bundle';

/** 帮助函数：base64url 编码。 */
function b64url(s: string): string {
  // Node Buffer; vitest 跑在 Node 环境
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeKey(payload: Record<string, unknown>, year = 2026): string {
  return `aster-ent-${year}-${b64url(JSON.stringify(payload))}`;
}

const VALID_PAYLOAD = {
  customer: 'Acme Corp',
  issuedAt: '2026-01-15T00:00:00.000Z',
  expiresAt: '2027-01-15T00:00:00.000Z',
  seatLimit: 500,
  tier: 'enterprise',
  features: ['sso', 'audit-export'],
};

const NOW_2026 = new Date('2026-06-15T00:00:00.000Z');
const NOW_2028 = new Date('2028-06-15T00:00:00.000Z');

describe('parseLicenseKey', () => {
  describe('missing', () => {
    it('undefined → status=missing', () => {
      const r = parseLicenseKey(undefined, NOW_2026);
      expect(r.status).toBe('missing');
      expect(r.reasonCode).toBe('env-missing');
      expect(r.keyPreview).toBe('');
      expect(r.payload).toBeUndefined();
    });

    it('空字符串 → status=missing', () => {
      const r = parseLicenseKey('', NOW_2026);
      expect(r.status).toBe('missing');
    });

    it('仅空格 → status=missing', () => {
      const r = parseLicenseKey('   ', NOW_2026);
      expect(r.status).toBe('missing');
    });
  });

  describe('malformed', () => {
    it('完全错误的字符串 → prefix-mismatch', () => {
      const r = parseLicenseKey('not-a-license', NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('prefix-mismatch');
    });

    it('错误的前缀 → prefix-mismatch', () => {
      const r = parseLicenseKey('aster-pro-2026-xxx', NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('prefix-mismatch');
    });

    it('前缀对但 base64 含非法字符 → 解析失败', () => {
      // 路径：前缀通过 → JSON.parse 失败（base64 含非法 char 会被 atob
      // 当成短 base64 处理；最终 JSON 不可解析）
      const r = parseLicenseKey('aster-ent-2026-####', NOW_2026);
      // # 不匹配 [A-Za-z0-9_-] → prefix regex 失败 → prefix-mismatch
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('prefix-mismatch');
    });

    it('base64 解码后不是 JSON → json-parse-failed', () => {
      const k = `aster-ent-2026-${b64url('not json at all')}`;
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('json-parse-failed');
    });

    it('payload 缺 customer → payload-shape-invalid', () => {
      const k = makeKey({ ...VALID_PAYLOAD, customer: '' });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('payload-shape-invalid');
    });

    it('payload tier 非法 → payload-shape-invalid', () => {
      const k = makeKey({ ...VALID_PAYLOAD, tier: 'free' });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('payload-shape-invalid');
    });

    it('payload seatLimit 非数字 → payload-shape-invalid', () => {
      const k = makeKey({ ...VALID_PAYLOAD, seatLimit: 'unlimited' });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('payload-shape-invalid');
    });

    it('payload seatLimit = 0 → payload-shape-invalid (codex M3)', () => {
      const k = makeKey({ ...VALID_PAYLOAD, seatLimit: 0 });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('payload-shape-invalid');
    });

    it('payload seatLimit = 1.5 (非整数) → payload-shape-invalid', () => {
      const k = makeKey({ ...VALID_PAYLOAD, seatLimit: 1.5 });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('payload-shape-invalid');
    });

    it('payload seatLimit = -999 (除 -1 外的负数) → payload-shape-invalid', () => {
      const k = makeKey({ ...VALID_PAYLOAD, seatLimit: -999 });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('payload-shape-invalid');
    });

    it('payload expiresAt 不可解析 → payload-shape-invalid', () => {
      const k = makeKey({ ...VALID_PAYLOAD, expiresAt: 'not-a-date' });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('payload-shape-invalid');
    });

    it('payload features 不是字符串数组 → payload-shape-invalid', () => {
      const k = makeKey({ ...VALID_PAYLOAD, features: [1, 2, 3] });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('malformed');
      expect(r.reasonCode).toBe('payload-shape-invalid');
    });
  });

  describe('expired', () => {
    it('当前时间 > expiresAt → status=expired，含 payload 和负 daysRemaining', () => {
      const k = makeKey(VALID_PAYLOAD); // expires 2027-01-15
      const r = parseLicenseKey(k, NOW_2028);
      expect(r.status).toBe('expired');
      expect(r.payload).toBeDefined();
      expect(r.payload!.customer).toBe('Acme Corp');
      expect(r.daysRemaining).toBeLessThan(0);
    });
  });

  describe('active', () => {
    it('一切正常 → active + payload + 正 daysRemaining', () => {
      const k = makeKey(VALID_PAYLOAD); // expires 2027-01-15
      const r = parseLicenseKey(k, NOW_2026); // now 2026-06-15
      expect(r.status).toBe('active');
      expect(r.payload).toBeDefined();
      expect(r.payload!.customer).toBe('Acme Corp');
      expect(r.payload!.seatLimit).toBe(500);
      expect(r.payload!.tier).toBe('enterprise');
      expect(r.payload!.features).toEqual(['sso', 'audit-export']);
      expect(r.daysRemaining).toBeGreaterThan(0);
      expect(r.keyPreview).toMatch(/^aster-en…$/);
    });

    it('seatLimit = -1 (unlimited) 是合法的', () => {
      const k = makeKey({ ...VALID_PAYLOAD, seatLimit: -1 });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('active');
      expect(r.payload!.seatLimit).toBe(-1);
    });

    it('enterprise-plus tier 合法', () => {
      const k = makeKey({ ...VALID_PAYLOAD, tier: 'enterprise-plus' });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('active');
      expect(r.payload!.tier).toBe('enterprise-plus');
    });

    it('空 features 数组合法', () => {
      const k = makeKey({ ...VALID_PAYLOAD, features: [] });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('active');
      expect(r.payload!.features).toEqual([]);
    });

    it('keyPreview 脱敏：只显示前 8 字符 + 省略号', () => {
      const k = makeKey(VALID_PAYLOAD);
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.keyPreview.length).toBeLessThan(k.length);
      expect(r.keyPreview).toContain('…');
    });

    it('UTF-8 客户名（中文）能正确解码 (codex M4)', () => {
      const k = makeKey({ ...VALID_PAYLOAD, customer: '德国电信 GmbH 中文测试' });
      const r = parseLicenseKey(k, NOW_2026);
      expect(r.status).toBe('active');
      expect(r.payload!.customer).toBe('德国电信 GmbH 中文测试');
    });

    it('所有 result 显式带 verification: "unsigned" (codex M1)', () => {
      // missing / malformed / expired / active 都必须有 verification 字段
      expect(parseLicenseKey(undefined, NOW_2026).verification).toBe('unsigned');
      expect(parseLicenseKey('not-a-license', NOW_2026).verification).toBe('unsigned');
      const k = makeKey(VALID_PAYLOAD);
      expect(parseLicenseKey(k, NOW_2026).verification).toBe('unsigned');
      expect(parseLicenseKey(k, NOW_2028).verification).toBe('unsigned');
    });
  });
});

describe('hasLicenseFeature (LegacyLicenseResult — 永远拒绝授权)', () => {
  // PR-L2 收紧：v1 parseLicenseKey 路径的 result 不能授权，因为没有签名保护。
  it('v1 active license → 永远 false（fail-closed）', () => {
    const k = makeKey(VALID_PAYLOAD);
    const r = parseLicenseKey(k, NOW_2026);
    expect(r.status).toBe('active');
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });

  it('v1 active license + feature 不在列表 → false', () => {
    const k = makeKey(VALID_PAYLOAD);
    const r = parseLicenseKey(k, NOW_2026);
    expect(hasLicenseFeature(r, 'never-shipped-feature')).toBe(false);
  });

  it('v1 expired license → false', () => {
    const k = makeKey(VALID_PAYLOAD);
    const r = parseLicenseKey(k, NOW_2028);
    expect(r.status).toBe('expired');
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });

  it('missing license → false', () => {
    const r = parseLicenseKey(undefined, NOW_2026);
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });

  it('malformed license → false', () => {
    const r = parseLicenseKey('garbage', NOW_2026);
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// v2: verifyLicenseKey 签名校验
// ---------------------------------------------------------------------------

function bytesToB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Buffer.from(digest).toString('hex');
}

/** 用一次性 Ed25519 keypair 签出真实 v2 license key。 */
async function makeSignedV2License(
  overrides: Partial<LicensePayloadV2> = {},
): Promise<{
  key: string;
  bundle: readonly TrustBundleEntry[];
  payload: LicensePayloadV2;
  publicKeyBytes: Uint8Array;
}> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', keyPair.publicKey),
  );
  const keyId = overrides.keyId ?? 'test-lic-2026-01';
  // base + overrides, 然后强制覆盖 keyId 确保与 URL keyId 一致。
  const payload: LicensePayloadV2 = Object.assign(
    {
      schemaVersion: 2 as const,
      licenseId: 'lic_test_01',
      keyId,
      customer: 'Acme Corp',
      issuedAt: '2026-01-15T00:00:00.000Z',
      expiresAt: '2027-01-15T00:00:00.000Z',
      seatLimit: 500,
      tier: 'enterprise' as const,
      features: ['sso', 'audit-export'] as ReadonlyArray<string>,
      sku: 'standard' as const,
      licenseTerm: 'annual' as const,
      deploymentBinding: null,
      revocationCheckUrl: 'https://license.aster-lang.cloud/revoked.json' as string | undefined,
    },
    overrides,
    { keyId },
  );
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = new Uint8Array(
    await crypto.subtle.sign('Ed25519', keyPair.privateKey, payloadBytes.slice().buffer),
  );
  const bundle: readonly TrustBundleEntry[] = [
    {
      keyId,
      purpose: 'license',
      pubKey: Buffer.from(publicKeyBytes).toString('base64'),
      status: 'active',
      activatedAt: '2026-01-01T00:00:00.000Z',
      fingerprint: await sha256Hex(publicKeyBytes),
    },
  ];
  return {
    key: `aster-ent-v2-${keyId}-${bytesToB64url(payloadBytes)}.${bytesToB64url(signature)}`,
    bundle,
    payload,
    publicKeyBytes,
  };
}

describe('verifyLicenseKey v2', () => {
  it('valid signature → trustStatus=verified, displayStatus=verified-active', async () => {
    const { key, bundle } = await makeSignedV2License();
    const r = await verifyLicenseKey(key, { now: NOW_2026, trustBundle: bundle });
    expect(r.trustStatus).toBe('verified');
    expect(r.entitlementStatus).toBe('active');
    expect(r.displayStatus).toBe('verified-active');
    expect(r.payload?.customer).toBe('Acme Corp');
    expect(r.diagnostics.signingKeyId).toBe(r.payload?.keyId);
    expect(r.diagnostics.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tampered payload → trustStatus=signature-invalid', async () => {
    const { key, bundle, payload } = await makeSignedV2License();
    const [, sig] = key.split('.');
    const tamperedBytes = new TextEncoder().encode(
      JSON.stringify({ ...payload, customer: 'Mallory' }),
    );
    const tampered = `aster-ent-v2-${payload.keyId}-${bytesToB64url(tamperedBytes)}.${sig}`;
    const r = await verifyLicenseKey(tampered, { now: NOW_2026, trustBundle: bundle });
    expect(r.trustStatus).toBe('signature-invalid');
    expect(r.displayStatus).toBe('signature-invalid');
  });

  it('unknown keyId → trustStatus=signature-untrusted-key', async () => {
    const { key } = await makeSignedV2License();
    const r = await verifyLicenseKey(key, { now: NOW_2026, trustBundle: [] });
    expect(r.trustStatus).toBe('signature-untrusted-key');
    expect(r.displayStatus).toBe('signature-untrusted-key');
  });

  it('retired key → trustStatus=signature-untrusted-key', async () => {
    const { key, bundle } = await makeSignedV2License();
    const retiredBundle: readonly TrustBundleEntry[] = bundle.map((e) => ({
      ...e,
      status: 'retired' as const,
      retiredAt: '2026-06-01T00:00:00.000Z',
    }));
    const r = await verifyLicenseKey(key, { now: NOW_2026, trustBundle: retiredBundle });
    expect(r.trustStatus).toBe('signature-untrusted-key');
  });

  it('notBefore in future → trustStatus=malformed', async () => {
    const { key, bundle } = await makeSignedV2License({
      notBefore: '2026-12-01T00:00:00.000Z',
    });
    const r = await verifyLicenseKey(key, { now: NOW_2026, trustBundle: bundle });
    expect(r.trustStatus).toBe('malformed');
    expect(r.diagnostics.reasonCode).toBe('not-before-in-future');
  });

  it('revocationCheckUrl 非 https → trustStatus=malformed', async () => {
    const { key, bundle } = await makeSignedV2License({
      revocationCheckUrl: 'http://license.aster-lang.cloud/revoked.json',
    });
    const r = await verifyLicenseKey(key, { now: NOW_2026, trustBundle: bundle });
    expect(r.trustStatus).toBe('malformed');
    expect(r.diagnostics.reasonCode).toBe('payload-shape-invalid');
  });

  it('air-gapped SKU → connectivityStatus 强制 not-applicable', async () => {
    const { key, bundle } = await makeSignedV2License({
      sku: 'air-gapped',
      licenseTerm: 'five-year',
      revocationCheckUrl: undefined,
    });
    const r = await verifyLicenseKey(key, {
      now: NOW_2026,
      trustBundle: bundle,
      // 即使提供 grace 也应被 coerce
      revocationState: { isRevoked: false, connectivityStatus: 'grace' },
    });
    expect(r.trustStatus).toBe('verified');
    expect(r.connectivityStatus).toBe('not-applicable');
    expect(r.displayStatus).toBe('verified-active');
  });

  it('revocationState.isRevoked → entitlementStatus=revoked', async () => {
    const { key, bundle } = await makeSignedV2License();
    const r = await verifyLicenseKey(key, {
      now: NOW_2026,
      trustBundle: bundle,
      revocationState: {
        isRevoked: true,
        revokedAt: '2026-05-01T00:00:00.000Z',
        revokedReason: 'security',
        revocationVersion: 42,
        connectivityStatus: 'fresh',
      },
    });
    expect(r.trustStatus).toBe('verified');
    expect(r.entitlementStatus).toBe('revoked');
    expect(r.displayStatus).toBe('verified-revoked');
    expect(r.diagnostics.revocationVersion).toBe(42);
  });

  it('expiresAt within 14 days → entitlementStatus=expiring-soon', async () => {
    const { key, bundle } = await makeSignedV2License({
      expiresAt: '2026-06-20T00:00:00.000Z',
    });
    const r = await verifyLicenseKey(key, { now: NOW_2026, trustBundle: bundle });
    expect(r.entitlementStatus).toBe('expiring-soon');
    expect(r.displayStatus).toBe('verified-expiring-soon');
  });

  it('grace-expired primary 强占 expiring-soon', async () => {
    const { key, bundle } = await makeSignedV2License({
      expiresAt: '2026-06-20T00:00:00.000Z',
    });
    const r = await verifyLicenseKey(key, {
      now: NOW_2026,
      trustBundle: bundle,
      revocationState: { isRevoked: false, connectivityStatus: 'grace-expired' },
    });
    expect(r.displayStatus).toBe('network-grace-expired');
    expect(r.secondaryAdvisories).toContain('expiring-soon');
  });

  it('v1 within deadline → trustStatus=legacy-unsigned', async () => {
    const k = makeKey(VALID_PAYLOAD);
    const r = await verifyLicenseKey(k, { now: NOW_2026 });
    expect(r.trustStatus).toBe('legacy-unsigned');
    expect(r.entitlementStatus).toBe('active');
    expect(r.displayStatus).toBe('legacy-unsigned');
  });

  it('hasLicenseFeature returns false for legacy-unsigned even when active', async () => {
    const k = makeKey(VALID_PAYLOAD);
    const r = await verifyLicenseKey(k, { now: NOW_2026 });
    expect(r.trustStatus).toBe('legacy-unsigned');
    expect(r.entitlementStatus).toBe('active');
    // 核心不变量：v1 不可用于授权
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });

  it('hasLicenseFeature returns true only for verified+active+listed feature', async () => {
    const { key, bundle } = await makeSignedV2License();
    const r = await verifyLicenseKey(key, { now: NOW_2026, trustBundle: bundle });
    expect(hasLicenseFeature(r, 'sso')).toBe(true);
    expect(hasLicenseFeature(r, 'custom-domain')).toBe(false);
  });

  it('verified + entitlement=revoked → hasLicenseFeature false', async () => {
    const { key, bundle } = await makeSignedV2License();
    const r = await verifyLicenseKey(key, {
      now: NOW_2026,
      trustBundle: bundle,
      revocationState: { isRevoked: true, connectivityStatus: 'fresh' },
    });
    expect(r.entitlementStatus).toBe('revoked');
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });

  it('missing key → trustStatus=missing, displayStatus=missing', async () => {
    const r = await verifyLicenseKey(undefined);
    expect(r.trustStatus).toBe('missing');
    expect(r.displayStatus).toBe('missing');
    expect(r.diagnostics.reasonCode).toBe('env-missing');
  });

  it('garbage v2 prefix → trustStatus=malformed', async () => {
    const r = await verifyLicenseKey('aster-ent-v2-bad-format', { now: NOW_2026 });
    expect(r.trustStatus).toBe('malformed');
    expect(r.diagnostics.reasonCode).toBe('prefix-mismatch');
  });

  it('v2 URL keyId 不在 trust bundle → signature-untrusted-key', async () => {
    // splitV2Key 按 trust bundle 已知 keyId 做前缀匹配（修复 codex Critical-3
    // 歧义正则）。替换 URL 里的 keyId 后 trust bundle 找不到匹配项 →
    // signature-untrusted-key，而不是走解析失败的 malformed 分支。
    const { key, bundle, payload } = await makeSignedV2License();
    const wrongKey = key.replace(payload.keyId, 'totally-different-key-id');
    const r = await verifyLicenseKey(wrongKey, { now: NOW_2026, trustBundle: bundle });
    expect(r.trustStatus).toBe('signature-untrusted-key');
    expect(r.diagnostics.reasonCode).toBe('unknown-signing-key');
  });

  it('v2 payload keyId 与 URL keyId 篡改不一致 → malformed', async () => {
    // 攻击者保留 URL keyId（trust bundle 有），但 payload 内塞错 keyId。
    // splitV2Key 切分按 URL keyId，但 isLicensePayloadV2 后的
    // parsed.keyId !== keyId 校验会捕获，返回 malformed。
    const { key, bundle, payload, publicKeyBytes: _unused } = await makeSignedV2License();
    void _unused;
    const tamperedPayloadBytes = new TextEncoder().encode(
      JSON.stringify({ ...payload, keyId: 'inner-mismatch-keyid' }),
    );
    const [, sig] = key.split('.');
    const tamperedKey = `aster-ent-v2-${payload.keyId}-${bytesToB64url(tamperedPayloadBytes)}.${sig}`;
    const r = await verifyLicenseKey(tamperedKey, { now: NOW_2026, trustBundle: bundle });
    expect(r.trustStatus).toBe('malformed');
  });
});

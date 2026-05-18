// license parser 行为：
//   - 空 / undefined → missing
//   - 前缀错 → malformed/prefix-mismatch
//   - base64 错 → malformed/base64-decode-failed
//   - JSON 错 → malformed/json-parse-failed
//   - payload shape 错 → malformed/payload-shape-invalid
//   - expiresAt 过期 → expired，含 daysRemaining < 0
//   - 一切正常 → active
//
// hasLicenseFeature：非 active 始终 false；active 看 features 数组

import { describe, it, expect } from 'vitest';
import { parseLicenseKey, hasLicenseFeature } from '@/lib/license';

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

describe('hasLicenseFeature', () => {
  it('active license + feature 在列表 → true', () => {
    const k = makeKey(VALID_PAYLOAD);
    const r = parseLicenseKey(k, NOW_2026);
    expect(hasLicenseFeature(r, 'sso')).toBe(true);
  });

  it('active license + feature 不在列表 → false', () => {
    const k = makeKey(VALID_PAYLOAD);
    const r = parseLicenseKey(k, NOW_2026);
    expect(hasLicenseFeature(r, 'never-shipped-feature')).toBe(false);
  });

  it('expired license → 始终 false（即使 feature 列出）', () => {
    const k = makeKey(VALID_PAYLOAD);
    const r = parseLicenseKey(k, NOW_2028);
    expect(r.status).toBe('expired');
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });

  it('missing license → 始终 false', () => {
    const r = parseLicenseKey(undefined, NOW_2026);
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });

  it('malformed license → 始终 false', () => {
    const r = parseLicenseKey('garbage', NOW_2026);
    expect(hasLicenseFeature(r, 'sso')).toBe(false);
  });
});

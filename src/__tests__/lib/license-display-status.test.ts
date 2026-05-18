// deriveDisplayStatus precedence matrix + air-gapped coercion + secondary advisories。
//
// 单一职责：deriveDisplayStatus 是纯函数，输入 4 维状态，输出 11 种 displayStatus 之一。
// 测试逐行覆盖 plan section 2.3 优先级矩阵。

import { describe, it, expect } from 'vitest';
import {
  computeSecondaryAdvisories,
  deriveDisplayStatus,
  type ConnectivityStatus,
  type DisplayStatus,
  type EntitlementStatus,
  type TrustStatus,
} from '@/lib/license';

describe('deriveDisplayStatus precedence matrix', () => {
  const cases: ReadonlyArray<{
    name: string;
    trust: TrustStatus;
    entitlement: EntitlementStatus | null;
    connectivity: ConnectivityStatus;
    expected: DisplayStatus;
  }> = [
    // trust 失败优先级最高（即便有更糟的 connectivity/entitlement 也以 trust 为准）
    { name: 'missing 屏蔽 revoked + grace-expired', trust: 'missing', entitlement: 'revoked', connectivity: 'grace-expired', expected: 'missing' },
    { name: 'malformed 屏蔽 revoked', trust: 'malformed', entitlement: 'revoked', connectivity: 'grace-expired', expected: 'malformed' },
    { name: 'signature-invalid', trust: 'signature-invalid', entitlement: 'active', connectivity: 'fresh', expected: 'signature-invalid' },
    { name: 'signature-untrusted-key', trust: 'signature-untrusted-key', entitlement: 'active', connectivity: 'fresh', expected: 'signature-untrusted-key' },
    { name: 'legacy-unsigned warning', trust: 'legacy-unsigned', entitlement: 'active', connectivity: 'fresh', expected: 'legacy-unsigned' },

    // trust='verified' 内部优先级：revoked > expired > grace-expired > expiring-soon > grace > active
    { name: 'verified-revoked 屏蔽 expired', trust: 'verified', entitlement: 'revoked', connectivity: 'grace-expired', expected: 'verified-revoked' },
    { name: 'verified-expired 屏蔽 grace-expired', trust: 'verified', entitlement: 'expired', connectivity: 'grace-expired', expected: 'verified-expired' },
    { name: 'network-grace-expired', trust: 'verified', entitlement: 'active', connectivity: 'grace-expired', expected: 'network-grace-expired' },
    { name: 'verified-expiring-soon 屏蔽 grace', trust: 'verified', entitlement: 'expiring-soon', connectivity: 'grace', expected: 'verified-expiring-soon' },
    { name: 'network-grace', trust: 'verified', entitlement: 'active', connectivity: 'grace', expected: 'network-grace' },

    // verified-active 三种条件（fresh / not-applicable / error 视为不掉到 grace）
    { name: 'verified-active fresh', trust: 'verified', entitlement: 'active', connectivity: 'fresh', expected: 'verified-active' },
    { name: 'verified-active not-applicable', trust: 'verified', entitlement: 'active', connectivity: 'not-applicable', expected: 'verified-active' },
    { name: 'verified-active connectivity=error 不掉级', trust: 'verified', entitlement: 'active', connectivity: 'error', expected: 'verified-active' },

    // 边界：grace-expired 在 expiring-soon 之上（plan 表第 8 行 > 第 9 行）
    { name: 'grace-expired 优先于 expiring-soon', trust: 'verified', entitlement: 'expiring-soon', connectivity: 'grace-expired', expected: 'network-grace-expired' },
  ];

  it.each(cases)('$name', ({ trust, entitlement, connectivity, expected }) => {
    expect(deriveDisplayStatus(trust, entitlement, connectivity, 'standard')).toBe(expected);
  });

  it('air-gapped SKU 强制 connectivity=not-applicable', () => {
    expect(deriveDisplayStatus('verified', 'active', 'grace', 'air-gapped')).toBe('verified-active');
    expect(deriveDisplayStatus('verified', 'active', 'grace-expired', 'air-gapped')).toBe('verified-active');
    expect(deriveDisplayStatus('verified', 'active', 'error', 'air-gapped')).toBe('verified-active');
  });

  it('air-gapped 不能掩盖 revoked / expired', () => {
    expect(deriveDisplayStatus('verified', 'revoked', 'grace-expired', 'air-gapped')).toBe('verified-revoked');
    expect(deriveDisplayStatus('verified', 'expired', 'grace-expired', 'air-gapped')).toBe('verified-expired');
  });

  it('sku=null 等同 standard 行为', () => {
    expect(deriveDisplayStatus('verified', 'active', 'grace', null)).toBe('network-grace');
    expect(deriveDisplayStatus('verified', 'active', 'grace-expired', null)).toBe('network-grace-expired');
  });

  it('trust failed + sku unknown 仍按 trust 短路', () => {
    expect(deriveDisplayStatus('missing', null, 'grace', null)).toBe('missing');
    expect(deriveDisplayStatus('signature-invalid', null, 'fresh', 'air-gapped')).toBe('signature-invalid');
  });
});

describe('computeSecondaryAdvisories', () => {
  it('verified active fresh 无 advisory', () => {
    expect(computeSecondaryAdvisories('verified', 'active', 'fresh')).toEqual([]);
  });

  it('primary=verified-expiring-soon 不重复加 expiring-soon advisory', () => {
    expect(computeSecondaryAdvisories('verified', 'expiring-soon', 'fresh')).not.toContain('expiring-soon');
  });

  it('expiring-soon 被高优先级 grace-expired 抢占时，作为 advisory 提示', () => {
    const advisories = computeSecondaryAdvisories('verified', 'expiring-soon', 'grace-expired');
    expect(advisories).toContain('expiring-soon');
  });

  it('connectivity=error 在 active 主状态下显示 revocation-stale', () => {
    expect(computeSecondaryAdvisories('verified', 'active', 'error')).toContain('revocation-stale');
  });

  it('connectivity=error 不在 grace / grace-expired 主状态下重复', () => {
    expect(computeSecondaryAdvisories('verified', 'active', 'grace-expired')).not.toContain('revocation-stale');
  });

  it('grace 被 expiring-soon 抢占时作为 advisory', () => {
    expect(computeSecondaryAdvisories('verified', 'expiring-soon', 'grace')).toContain('network-grace');
  });

  it('primary=network-grace 不重复加 grace advisory', () => {
    expect(computeSecondaryAdvisories('verified', 'active', 'grace')).not.toContain('network-grace');
  });

  // 关键不变量：trust !== 'verified' 时不衍生 entitlement / connectivity advisory
  // （避免 missing 状态下出现毫无意义的 "revocation stale"）
  it.each([
    ['missing'],
    ['malformed'],
    ['signature-invalid'],
    ['signature-untrusted-key'],
  ] as const)('trust=%s 不衍生 connectivity advisory', (trust) => {
    const advisories = computeSecondaryAdvisories(trust, null, 'error');
    expect(advisories).not.toContain('revocation-stale');
    expect(advisories).not.toContain('network-grace');
    expect(advisories).not.toContain('expiring-soon');
  });

  it('legacy-unsigned + 任何 connectivity 也不衍生 verified-only advisory', () => {
    const advisories = computeSecondaryAdvisories('legacy-unsigned', 'active', 'grace');
    expect(advisories).not.toContain('network-grace');
    expect(advisories).not.toContain('revocation-stale');
  });
});

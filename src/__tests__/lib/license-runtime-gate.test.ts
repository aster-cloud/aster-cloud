// license-runtime-gate 行为：
//   - SaaS 模式永远不 gate
//   - on-prem missing/malformed/revoked/expired/grace-expired → gated
//   - verified-active / verified-expiring-soon / network-grace → not gated
//   - 每分钟内 cache 不重复 verify

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  verifyMock: vi.fn(),
}));
let isSaas = false;

vi.mock('@/lib/deployment-mode', () => ({
  get IS_SAAS() {
    return isSaas;
  },
}));

vi.mock('@/lib/prisma', async () => {
  const real = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...real,
    db: {
      query: { licenseCache: { findFirst: mocks.findFirst } },
    },
  };
});

vi.mock('@/lib/license', async () => {
  const actual = await vi.importActual<typeof import('@/lib/license')>('@/lib/license');
  return {
    ...actual,
    verifyLicenseKey: mocks.verifyMock,
  };
});

import {
  isLicenseReadOnlyGated,
  __resetLicenseRuntimeGateCacheForTests,
} from '@/lib/license-runtime-gate';

beforeEach(() => {
  vi.clearAllMocks();
  isSaas = false;
  __resetLicenseRuntimeGateCacheForTests();
  mocks.findFirst.mockResolvedValue(undefined);
});

afterEach(() => {
  __resetLicenseRuntimeGateCacheForTests();
});

describe('isLicenseReadOnlyGated', () => {
  it('SaaS 模式 → not gated（永远）', async () => {
    isSaas = true;
    const result = await isLicenseReadOnlyGated();
    expect(result.gated).toBe(false);
    expect(mocks.verifyMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'missing',
      { trustStatus: 'missing', entitlementStatus: null, displayStatus: 'missing' },
      'missing',
    ],
    [
      'malformed → reason=malformed',
      { trustStatus: 'malformed', entitlementStatus: null, displayStatus: 'malformed' },
      'malformed',
    ],
    [
      'signature-invalid → reason=malformed',
      { trustStatus: 'signature-invalid', entitlementStatus: null, displayStatus: 'signature-invalid' },
      'malformed',
    ],
    [
      'legacy-unsigned → reason=malformed（v1 不能用于授权）',
      { trustStatus: 'legacy-unsigned', entitlementStatus: 'active', displayStatus: 'legacy-unsigned' },
      'malformed',
    ],
    [
      'verified-revoked → reason=revoked',
      { trustStatus: 'verified', entitlementStatus: 'revoked', displayStatus: 'verified-revoked' },
      'revoked',
    ],
    [
      'verified-expired → reason=expired',
      { trustStatus: 'verified', entitlementStatus: 'expired', displayStatus: 'verified-expired' },
      'expired',
    ],
    [
      'network-grace-expired → reason=grace-expired',
      { trustStatus: 'verified', entitlementStatus: 'active', displayStatus: 'network-grace-expired' },
      'grace-expired',
    ],
  ] as const)('on-prem + %s → gated', async (_name, verifyResult, expectedReason) => {
    mocks.verifyMock.mockResolvedValueOnce(verifyResult);
    const result = await isLicenseReadOnlyGated();
    expect(result.gated).toBe(true);
    expect(result.reason).toBe(expectedReason);
  });

  it.each([
    [
      'verified-active fresh',
      { trustStatus: 'verified', entitlementStatus: 'active', displayStatus: 'verified-active' },
    ],
    [
      'verified-expiring-soon（仍可写）',
      { trustStatus: 'verified', entitlementStatus: 'expiring-soon', displayStatus: 'verified-expiring-soon' },
    ],
    [
      'network-grace（grace 期内还能写）',
      { trustStatus: 'verified', entitlementStatus: 'active', displayStatus: 'network-grace' },
    ],
  ] as const)('on-prem + %s → not gated', async (_name, verifyResult) => {
    mocks.verifyMock.mockResolvedValueOnce(verifyResult);
    const result = await isLicenseReadOnlyGated();
    expect(result.gated).toBe(false);
  });

  it('单分钟内重复调用 → cache 命中（verify 只调一次）', async () => {
    mocks.verifyMock.mockResolvedValue({
      trustStatus: 'verified',
      entitlementStatus: 'active',
      displayStatus: 'verified-active',
    });
    await isLicenseReadOnlyGated();
    await isLicenseReadOnlyGated();
    await isLicenseReadOnlyGated();
    expect(mocks.verifyMock).toHaveBeenCalledTimes(1);
  });

  it('verify 抛错 → 视为 missing（fail-closed）', async () => {
    mocks.verifyMock.mockRejectedValueOnce(new Error('crypto-unavailable'));
    const result = await isLicenseReadOnlyGated();
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('missing');
  });
});

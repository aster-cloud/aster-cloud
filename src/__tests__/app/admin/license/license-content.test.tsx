// /admin/license v2 UI tests。
//
// 设计意图：
//   - 断言 11 种 displayStatus 均只产生一个 primary banner
//   - aria role / tone 直接覆盖 plan section 2.3 的状态映射
//   - air-gapped 不应显示 grace 警告，而是显示中性 policy note
//   - secondary advisories 必须是 inline list，不能产生额外 banner

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type {
  DisplayStatus,
  LicensePayloadV2,
  LicenseResult,
} from '@/lib/license';
import { LicenseStatusContent } from '@/app/[locale]/(dashboard)/admin/license/license-content';

// 简化 next-intl mock：仅返回 key + vars，使测试断言 key 名而非翻译内容
vi.mock('next-intl', () => ({
  useTranslations:
    (ns?: string) =>
    (key: string, vars?: Record<string, unknown>) =>
      `${ns ?? ''}.${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const EXPECTED: Record<DisplayStatus, { role: 'alert' | 'status'; tone: string }> = {
  missing: { role: 'alert', tone: 'danger' },
  malformed: { role: 'alert', tone: 'danger' },
  'signature-invalid': { role: 'alert', tone: 'danger' },
  'signature-untrusted-key': { role: 'alert', tone: 'danger' },
  'binding-mismatch': { role: 'alert', tone: 'danger' },
  'legacy-unsigned': { role: 'status', tone: 'warning' },
  'verified-revoked': { role: 'alert', tone: 'danger' },
  'verified-expired': { role: 'alert', tone: 'danger' },
  'network-grace-expired': { role: 'alert', tone: 'strong-warning' },
  'verified-expiring-soon': { role: 'status', tone: 'warning' },
  'network-grace': { role: 'status', tone: 'info' },
  'verified-active': { role: 'status', tone: 'success' },
};

describe('LicenseStatusContent v2', () => {
  for (const [displayStatus, expected] of Object.entries(EXPECTED) as Array<
    [DisplayStatus, { role: 'alert' | 'status'; tone: string }]
  >) {
    it(`${displayStatus} renders exactly one primary banner with role=${expected.role} tone=${expected.tone}`, () => {
      const { container } = render(
        <LicenseStatusContent result={buildResult(displayStatus)} />,
      );

      const banners = container.querySelectorAll('[data-license-banner="primary"]');
      expect(banners).toHaveLength(1);
      expect(banners[0]).toHaveAttribute('role', expected.role);
      expect(banners[0]).toHaveAttribute('data-tone', expected.tone);
    });
  }

  it('air-gapped SKU 显示 policy note，不显示 grace 警告', () => {
    render(
      <LicenseStatusContent
        result={buildResult('verified-active', {
          payload: buildPayload({ sku: 'air-gapped', revocationCheckUrl: undefined }),
          connectivityStatus: 'not-applicable',
        })}
      />,
    );

    expect(
      screen.getByText('admin.license.revocation.airGappedPolicy'),
    ).toBeInTheDocument();
    expect(screen.queryByText('admin.license.revocation.grace')).not.toBeInTheDocument();
  });

  it('secondary advisories 渲染为 inline list（不是额外 banner）', () => {
    const { container } = render(
      <LicenseStatusContent
        result={buildResult('verified-expiring-soon', {
          secondaryAdvisories: ['network-grace'],
        })}
        cacheMeta={{ lastCheckMinutesAgo: 42 }}
      />,
    );

    expect(
      container.querySelectorAll('[data-license-banner="primary"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-license-advisories="inline"]'),
    ).toBeInTheDocument();
  });

  it('payload 缺失时不渲染 LicenseDetails 与 RevocationStatusPanel', () => {
    const { container } = render(
      <LicenseStatusContent result={buildResult('missing')} />,
    );
    // 没有 details heading（payload 缺失时整个 section 不渲染）
    expect(screen.queryByText('admin.license.details.heading')).not.toBeInTheDocument();
    expect(
      container.querySelector('[aria-labelledby="license-revocation-heading"]'),
    ).toBeNull();
  });

  it('verified-expired 仍渲染 LicenseDetails（operator 需要 context）', () => {
    render(
      <LicenseStatusContent result={buildResult('verified-expired')} />,
    );
    expect(screen.getByText('admin.license.details.heading')).toBeInTheDocument();
  });
});

function buildResult(
  displayStatus: DisplayStatus,
  overrides: Partial<LicenseResult> = {},
): LicenseResult {
  const trustStatus =
    displayStatus === 'missing'
      ? 'missing'
      : displayStatus === 'malformed'
        ? 'malformed'
        : displayStatus === 'signature-invalid'
          ? 'signature-invalid'
          : displayStatus === 'signature-untrusted-key'
            ? 'signature-untrusted-key'
            : displayStatus === 'legacy-unsigned'
              ? 'legacy-unsigned'
              : 'verified';

  const entitlementStatus =
    displayStatus === 'verified-revoked'
      ? 'revoked'
      : displayStatus === 'verified-expired'
        ? 'expired'
        : displayStatus === 'verified-expiring-soon'
          ? 'expiring-soon'
          : trustStatus === 'verified' || trustStatus === 'legacy-unsigned'
            ? 'active'
            : null;

  const connectivityStatus =
    displayStatus === 'network-grace'
      ? 'grace'
      : displayStatus === 'network-grace-expired'
        ? 'grace-expired'
        : trustStatus === 'verified'
          ? 'fresh'
          : 'not-applicable';

  return {
    trustStatus,
    entitlementStatus,
    connectivityStatus,
    displayStatus,
    payload:
      trustStatus === 'verified' || trustStatus === 'legacy-unsigned'
        ? buildPayload()
        : undefined,
    keyPreview: 'aster-en…',
    daysRemaining:
      displayStatus === 'verified-expired'
        ? -3
        : displayStatus === 'verified-expiring-soon'
          ? 7
          : 120,
    secondaryAdvisories: [],
    diagnostics: {},
    ...overrides,
  };
}

function buildPayload(
  overrides: Partial<LicensePayloadV2> = {},
): LicensePayloadV2 {
  const base: LicensePayloadV2 = {
    schemaVersion: 2,
    licenseId: 'lic_test_123',
    keyId: 'lic-2026-01',
    customer: 'Acme Corp',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    seatLimit: 100,
    tier: 'enterprise',
    features: ['sso'],
    sku: 'standard',
    licenseTerm: 'annual',
    deploymentBinding: { deploymentId: "a".repeat(64), deploymentLabel: "test-deployment" },
    revocationCheckUrl: 'https://license.aster-lang.cloud/revoked.json',
  };
  return { ...base, ...overrides };
}

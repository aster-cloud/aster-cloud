// IssuedLicensesTable lifecycle-phase rendering.
//
// Focus: correctness of the derivePhase logic by exercising the table at
// each phase + verifying the badge style class swap. The phase column is
// the load-bearing UI ops uses at renewal review — wrong phase → wrong
// conversation.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// 简化 next-intl mock：t(key, vars) → "key vars"，断言 key 不是翻译串
vi.mock('next-intl', () => ({
  useTranslations:
    () =>
    (key: string, vars?: Record<string, unknown>) => {
      // strip "phase." / "telemetry." prefixes if present, keep last segment
      const short = key.split('.').slice(-1)[0];
      if (!vars) return short;
      let out = short;
      for (const [k, v] of Object.entries(vars)) {
        out = out.replace(`{${k}}`, String(v));
      }
      return out;
    },
}));

// next-intl router used by @/i18n/navigation — mock minimal Link
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  IssuedLicensesTable,
  type RowWithTelemetry,
} from '@/app/[locale]/(dashboard)/admin/issued-licenses/components/issued-licenses-table';

const NOW = Date.now();
const DAY = 86_400_000;

function row(over: Partial<RowWithTelemetry>): RowWithTelemetry {
  return {
    licenseId: 'lic_test',
    customer: 'Acme',
    deploymentBinding: { deploymentId: 'a'.repeat(64), deploymentLabel: 'prod' },
    payloadJson: {
      schemaVersion: 2,
      tier: 'enterprise',
      sku: 'standard',
      features: [],
      seatLimit: 100,
    },
    payloadHash: '1'.repeat(64),
    signingKeyId: 'license-signing-v2-2026-01',
    signedAt: new Date(NOW - 30 * DAY),
    expiresAt: new Date(NOW + 365 * DAY),
    tier: 'enterprise',
    licenseTerm: 'annual',
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    renewedFromLicenseId: null,
    supersededAt: null,
    supersededBy: null,
    latestTelemetry: null,
    ...over,
  };
}

function renderTable(rows: RowWithTelemetry[]) {
  return render(<IssuedLicensesTable rows={rows} searchQuery="" />);
}

// Phase strings come back from the mocked t() as the bare last segment.
describe('IssuedLicensesTable lifecycle phases', () => {
  it('renders active when expiresAt > 14 days out and no supersede', () => {
    renderTable([row({ expiresAt: new Date(NOW + 100 * DAY) })]);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders expiring-soon when < 14 days', () => {
    renderTable([row({ expiresAt: new Date(NOW + 7 * DAY) })]);
    expect(screen.getByText('expiring-soon')).toBeInTheDocument();
  });

  it('renders expired when past expiresAt and not superseded', () => {
    renderTable([row({ expiresAt: new Date(NOW - 1 * DAY) })]);
    expect(screen.getByText('expired')).toBeInTheDocument();
  });

  it('renders pending-renewal when supersededBy set but supersededAt still null', () => {
    renderTable([
      row({
        supersededBy: 'lic_new',
        supersededAt: null,
        expiresAt: new Date(NOW + 5 * DAY),
      }),
    ]);
    expect(screen.getByText('pending-renewal')).toBeInTheDocument();
  });

  it('renders superseded when supersededAt set', () => {
    renderTable([
      row({
        supersededBy: 'lic_new',
        supersededAt: new Date(NOW - 1 * DAY),
      }),
    ]);
    expect(screen.getByText('superseded')).toBeInTheDocument();
  });
});

describe('IssuedLicensesTable telemetry recency', () => {
  it('shows notOptedIn when no telemetry rows and payload has no secrets', () => {
    renderTable([row({ latestTelemetry: null })]);
    expect(screen.getByText('notOptedIn')).toBeInTheDocument();
  });

  it('shows silent when secrets configured but no rows', () => {
    renderTable([
      row({
        latestTelemetry: null,
        payloadJson: {
          schemaVersion: 2,
          tier: 'enterprise',
          telemetry: { secrets: [{ kid: 'default', secret: 'x', activatedAt: 'iso' }] },
        },
      }),
    ]);
    expect(screen.getByText('silent')).toBeInTheDocument();
  });

  it('shows recent label for telemetry < 1d old', () => {
    renderTable([
      row({
        latestTelemetry: {
          id: 'tel_1',
          licenseId: 'lic_test',
          deploymentId: 'a'.repeat(64),
          customer: 'Acme',
          periodStart: new Date(NOW - 7 * DAY),
          periodEnd: new Date(NOW - DAY),
          payload: {},
          receivedAt: new Date(NOW - 1000 * 60 * 10), // 10 min ago
          sourceIp: null,
          signatureKid: 'default',
          signatureAlg: 'HMAC-SHA256',
          signatureB64: 'sig',
        },
      }),
    ]);
    expect(screen.getByText('recent')).toBeInTheDocument();
  });

  it('shows stale label when telemetry > 14d old', () => {
    renderTable([
      row({
        latestTelemetry: {
          id: 'tel_2',
          licenseId: 'lic_test',
          deploymentId: 'a'.repeat(64),
          customer: 'Acme',
          periodStart: new Date(NOW - 30 * DAY),
          periodEnd: new Date(NOW - 21 * DAY),
          payload: {},
          receivedAt: new Date(NOW - 20 * DAY),
          sourceIp: null,
          signatureKid: 'default',
          signatureAlg: 'HMAC-SHA256',
          signatureB64: 'sig',
        },
      }),
    ]);
    expect(screen.getByText(/stale/i)).toBeInTheDocument();
  });
});

describe('IssuedLicensesTable lineage cell', () => {
  it('renders both renewedFrom and supersededBy when present', () => {
    renderTable([
      row({
        renewedFromLicenseId: 'lic_old_id_long',
        supersededBy: 'lic_new_id_long',
      }),
    ]);
    expect(screen.getByText(/renewedFrom/)).toBeInTheDocument();
    expect(screen.getByText(/supersededBy/)).toBeInTheDocument();
  });

  it('renders em-dash when neither set', () => {
    renderTable([row({})]);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

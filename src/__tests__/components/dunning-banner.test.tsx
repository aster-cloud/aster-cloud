// DunningBanner behavior:
//   - SaaS + past_due → renders warning
//   - SaaS + no data → renders nothing (fetch returns null)
//   - on-prem → renders nothing AND never fetches (no /api/user/dunning-status hit)

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns ?? ''}.${key}(${JSON.stringify(vars)})` : `${ns ?? ''}.${key}`,
}));

const fetchMock = vi.fn();
beforeAll(() => {
  // 安装全局 fetch mock。每个测试自己清理。
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.resetModules();
  fetchMock.mockReset();
});

describe('DunningBanner — SaaS mode', () => {
  it('fetches dunning-status and renders past_due warning', async () => {
    vi.doMock('@/hooks/use-deployment-mode', () => ({
      CLIENT_CAPABILITIES: {
        billing: true,
        pricing: true,
        riskTier: true,
        dunning: true,
        signup: true,
        mixpanel: true,
        resend: true,
        license: false,
        sso: false,
      },
    }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscriptionStatus: 'past_due',
        gracePeriodEndsAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
        downgradedAt: null,
      }),
    });

    const { DunningBanner } = await import('@/components/dashboard/dunning-banner');
    render(<DunningBanner />);

    // i18n 回显形式：dashboard.dunning.paymentFailedTitle
    await waitFor(() => {
      expect(
        screen.getByText(/dashboard\.dunning\.paymentFailedTitle/),
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/user/dunning-status');
  });

  it('renders nothing when fetch returns null', async () => {
    vi.doMock('@/hooks/use-deployment-mode', () => ({
      CLIENT_CAPABILITIES: { billing: true, dunning: true } as Record<string, boolean>,
    }));
    fetchMock.mockResolvedValueOnce({ ok: false });

    const { DunningBanner } = await import('@/components/dashboard/dunning-banner');
    const { container } = render(<DunningBanner />);

    await waitFor(() => {
      // No banner content — only the wrapper (no children)
      expect(container.querySelector('strong')).toBeNull();
    });
  });
});

describe('DunningBanner — on-prem mode', () => {
  it('does NOT call fetch and renders nothing', async () => {
    vi.doMock('@/hooks/use-deployment-mode', () => ({
      CLIENT_CAPABILITIES: { billing: false, dunning: false } as Record<string, boolean>,
    }));

    const { DunningBanner } = await import('@/components/dashboard/dunning-banner');
    const { container } = render(<DunningBanner />);

    // 等一个 microtask 让 useEffect 跑完
    await waitFor(() => {
      expect(container.querySelector('strong')).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

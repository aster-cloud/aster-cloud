// license-renewal-warning cron 行为：
//   - SaaS 模式 404；on-prem 才工作
//   - missing CRON_SECRET → 503；wrong → 401
//   - no license → 204；> 30 days → no Slack
//   - 14 days → Slack called + record updated
//   - same threshold already notified → no-op

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  canLicense: true,
  findFirst: vi.fn(),
  updateSet: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('@/lib/deployment-mode', () => ({
  get CAN_LICENSE() {
    return mocks.canLicense;
  },
}));

vi.mock('@/lib/prisma', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...schema,
    db: {
      query: { licenseCache: { findFirst: mocks.findFirst } },
      update: vi.fn(() => ({
        set: mocks.updateSet.mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      })),
    },
  };
});

function req(secret = 'cron-secret') {
  return new NextRequest('https://example.test/api/cron/license-renewal-warning', {
    method: 'POST',
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function cache(daysRemaining: number, renewalNotifyRecord: unknown = {}) {
  return {
    id: 'current',
    licenseId: 'lic_test',
    licenseKeyHash: 'hash',
    payloadJson: {
      licenseId: 'lic_test',
      customer: 'Acme',
      expiresAt: new Date(
        Date.now() + daysRemaining * 24 * 60 * 60 * 1000,
      ).toISOString(),
    },
    signingKeyId: 'lic-test',
    verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    renewalNotifyRecord,
    updatedAt: new Date(),
  };
}

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/cron/license-renewal-warning/route');
}

describe('/api/cron/license-renewal-warning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canLicense = true;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.CRON_SECRET = 'cron-secret';
    process.env.LICENSES_SLACK_WEBHOOK = 'https://hooks.slack.test/x';
    global.fetch = mocks.fetch as unknown as typeof fetch;
    mocks.fetch.mockResolvedValue(new Response('ok', { status: 200 }));
  });

  it('SaaS mode → 404', async () => {
    mocks.canLicense = false;
    const { POST } = await loadRoute();
    expect((await POST(req())).status).toBe(404);
  });

  it('missing CRON_SECRET in production → 503', async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await loadRoute();
    expect((await POST(req(''))).status).toBe(503);
  });

  it('wrong CRON_SECRET → 401', async () => {
    const { POST } = await loadRoute();
    expect((await POST(req('wrong'))).status).toBe(401);
  });

  it('no license cache → 204', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const { POST } = await loadRoute();
    expect((await POST(req())).status).toBe(204);
  });

  it('> 30 days → no Slack notification', async () => {
    mocks.findFirst.mockResolvedValue(cache(45));
    const { POST } = await loadRoute();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('14 days → Slack called + threshold recorded', async () => {
    mocks.findFirst.mockResolvedValue(cache(14));
    const { POST } = await loadRoute();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        renewalNotifyRecord: expect.objectContaining({
          thresholds: expect.objectContaining({ '14': expect.any(String) }),
        }),
      }),
    );
  });

  it('Slack delivery failure → no notify record written, retry next cron', async () => {
    mocks.findFirst.mockResolvedValue(cache(14));
    // mock Slack 返回 5xx
    mocks.fetch.mockResolvedValue(new Response('err', { status: 500 }));
    const { POST } = await loadRoute();
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      notified: false,
      reason: 'slack-delivery-failed',
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('already notified same threshold → no-op', async () => {
    mocks.findFirst.mockResolvedValue(
      cache(14, {
        version: 'lic-test:2026-01-01T00:00:00.000Z',
        thresholds: { '14': '2026-05-01T00:00:00.000Z' },
      }),
    );
    const { POST } = await loadRoute();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });
});

// POST /api/cron/license-revocation-refresh route 行为：
//   - SaaS mode（CAN_LICENSE=false）→ 404，不调 refresh
//   - missing CRON_SECRET in production → 503（requireCronAuth fail-closed）
//   - wrong CRON_SECRET → 401
//   - air-gapped → 204
//   - updated/not-modified/error → JSON outcome（version 转 string，避免 bigint serialize 失败）

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const refreshLicenseRevocationCache = vi.fn();
let canLicense = true;

vi.mock('@/lib/license-revocation', () => ({
  refreshLicenseRevocationCache,
}));

vi.mock('@/lib/deployment-mode', () => ({
  get CAN_LICENSE() {
    return canLicense;
  },
}));

function req(secret?: string) {
  return new NextRequest(
    'https://example.test/api/cron/license-revocation-refresh',
    {
      method: 'POST',
      headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
    },
  );
}

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/cron/license-revocation-refresh/route');
}

describe('/api/cron/license-revocation-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canLicense = true;
    // NODE_ENV 在 TS NodeJS.ProcessEnv 类型里是 readonly，绕过类型校验
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.CRON_SECRET = 'cron-secret';
    refreshLicenseRevocationCache.mockResolvedValue({
      outcome: 'updated',
      version: BigInt(7),
      isRevoked: true,
      cache: { licenseId: 'lic_1', isRevoked: true },
    });
  });

  it('CAN_LICENSE=false（SaaS）→ 404 before cron auth', async () => {
    canLicense = false;
    const { POST } = await loadRoute();
    const res = await POST(req('cron-secret'));
    expect(res.status).toBe(404);
    expect(refreshLicenseRevocationCache).not.toHaveBeenCalled();
  });

  it('CRON_SECRET 缺失（生产）→ 503', async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await loadRoute();
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(refreshLicenseRevocationCache).not.toHaveBeenCalled();
  });

  it('错的 CRON_SECRET → 401', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req('wrong'));
    expect(res.status).toBe(401);
    expect(refreshLicenseRevocationCache).not.toHaveBeenCalled();
  });

  it('air-gapped → 204 No Content', async () => {
    refreshLicenseRevocationCache.mockResolvedValue({
      outcome: 'air-gapped',
      cache: { licenseId: 'lic_1', isRevoked: false },
      isRevoked: false,
    });
    const { POST } = await loadRoute();
    const res = await POST(req('cron-secret'));
    expect(res.status).toBe(204);
  });

  it('updated → 200 + version 字符串 + isRevoked', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req('cron-secret'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      outcome: 'updated',
      version: '7',
      isRevoked: true,
    });
  });

  it('not-modified → 200', async () => {
    refreshLicenseRevocationCache.mockResolvedValue({
      outcome: 'not-modified',
      version: BigInt(7),
      isRevoked: false,
      cache: { licenseId: 'lic_1', isRevoked: false },
    });
    const { POST } = await loadRoute();
    const res = await POST(req('cron-secret'));
    await expect(res.json()).resolves.toMatchObject({
      outcome: 'not-modified',
      isRevoked: false,
    });
  });

  it('network-error → 200 + error 字段', async () => {
    refreshLicenseRevocationCache.mockResolvedValue({
      outcome: 'network-error',
      version: BigInt(7),
      isRevoked: false,
      error: { url: 'https://license.example/revoked.json', networkError: 'timeout' },
      cache: { licenseId: 'lic_1', isRevoked: false },
    });
    const { POST } = await loadRoute();
    const res = await POST(req('cron-secret'));
    await expect(res.json()).resolves.toMatchObject({
      outcome: 'network-error',
      error: { networkError: 'timeout' },
    });
  });
});

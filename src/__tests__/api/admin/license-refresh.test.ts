// POST /api/admin/license/refresh：
//   - SaaS（CAN_LICENSE=false）→ 404
//   - 非 admin → 404（不泄露端点存在）
//   - air-gapped → 204
//   - updated → 200 + no-store + JSON outcome
//
// 用 vi.mock + resetModules 让 CAN_LICENSE 可在测试间换值。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshLicenseRevocationCache = vi.fn();
const isAdminFromSession = vi.fn();
const requireLicenseWriteOk = vi.fn();
let canLicense = true;

vi.mock('@/lib/license-revocation', () => ({
  refreshLicenseRevocationCache,
}));

vi.mock('@/lib/admin-auth', () => ({
  isAdminFromSession,
}));

vi.mock('@/lib/license-write-gate', () => ({
  requireLicenseWriteOk,
}));

vi.mock('@/lib/deployment-mode', () => ({
  get CAN_LICENSE() {
    return canLicense;
  },
}));

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/admin/license/refresh/route');
}

describe('/api/admin/license/refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canLicense = true;
    isAdminFromSession.mockResolvedValue({ userId: 'admin_1' });
    // 默认 write gate 放行（license 有效）；个别测试 override
    requireLicenseWriteOk.mockResolvedValue(null);
    refreshLicenseRevocationCache.mockResolvedValue({
      outcome: 'updated',
      version: BigInt(12),
      isRevoked: false,
      cache: { licenseId: 'lic_1', isRevoked: false },
    });
  });

  it('非 admin → 404', async () => {
    isAdminFromSession.mockResolvedValue(null);
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(404);
    expect(refreshLicenseRevocationCache).not.toHaveBeenCalled();
  });

  it('SaaS mode → 404', async () => {
    canLicense = false;
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it('air-gapped → 204 + no-store', async () => {
    refreshLicenseRevocationCache.mockResolvedValue({
      outcome: 'air-gapped',
      cache: { licenseId: 'lic_1', isRevoked: false },
      isRevoked: false,
    });
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('updated → 200 + no-store + JSON', async () => {
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.json()).resolves.toMatchObject({
      outcome: 'updated',
      version: '12',
      isRevoked: false,
    });
  });

  it('read-only mode（grace-expired）→ 503 + reason', async () => {
    // requireLicenseWriteOk 返回 503，refresh 不应被调用
    const { NextResponse } = await import('next/server');
    requireLicenseWriteOk.mockResolvedValue(
      NextResponse.json(
        { error: 'license-read-only-mode', reason: 'grace-expired' },
        { status: 503 },
      ),
    );
    const { POST } = await loadRoute();
    const res = await POST();
    expect(res.status).toBe(503);
    expect(refreshLicenseRevocationCache).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'license-read-only-mode',
      reason: 'grace-expired',
    });
  });
});

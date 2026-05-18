// admin metrics route 行为：
//   - 非 admin → 直接转 requireAdmin response
//   - admin → 200 + Prometheus text exposition 含已知 metric 名

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  licenseFindFirst: vi.fn(),
  revokedFindMany: vi.fn(),
  pubFindFirst: vi.fn(),
}));

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: mocks.requireAdmin }));

vi.mock('@/lib/prisma', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...schema,
    db: {
      query: {
        licenseCache: { findFirst: mocks.licenseFindFirst },
        revokedLicenses: { findMany: mocks.revokedFindMany },
        revocationPublications: { findFirst: mocks.pubFindFirst },
      },
    },
  };
});

describe('GET /api/admin/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ userId: 'admin' });
    mocks.licenseFindFirst.mockResolvedValue({
      lastSuccessfulRevocationCheckAt: new Date(Date.now() - 1000),
    });
    mocks.revokedFindMany.mockResolvedValue([{ licenseId: 'lic_1' }]);
    mocks.pubFindFirst.mockResolvedValue({ version: BigInt(7) });
  });

  it('non-admin → requireAdmin denial', async () => {
    const { NextResponse } = await import('next/server');
    const denied = new NextResponse(null, { status: 404 });
    mocks.requireAdmin.mockResolvedValue(denied);
    const { GET } = await import('@/app/api/admin/metrics/route');
    expect(await GET()).toBe(denied);
  });

  it('admin → 200 + Prometheus text + no-store', async () => {
    const { GET } = await import('@/app/api/admin/metrics/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain('aster_license_verified_total');
    expect(body).toContain('aster_license_refresh_total');
    expect(body).toContain('aster_license_revoked_active');
    expect(body).toContain('aster_revocation_manifest_version');
  });
});

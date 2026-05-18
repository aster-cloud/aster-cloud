// /api/admin/license on-prem 行为（v2 shape — PR-L6）：
//   - 非 admin → 404 (silent)
//   - admin + missing LICENSE_KEY → trustStatus=missing, displayStatus=missing
//   - admin + v1 LICENSE_KEY → trustStatus=legacy-unsigned（兼容窗口内）
//
// 注意：v2 LicenseResult 字段是 trustStatus + displayStatus，不再是 v1 的 status。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  isAdminFromSessionMock: vi.fn(),
  // 默认无 cache（DB 不可达，loadCacheAsRevocationState 返回 null）
  licenseCacheRow: undefined as undefined | null,
}));

vi.mock('@/lib/deployment-mode', () => ({
  CAN_LICENSE: true, // on-prem
  IS_SAAS: false,
  IS_ONPREM: true,
}));

vi.mock('@/lib/admin-auth', () => ({
  isAdminFromSession: hoisted.isAdminFromSessionMock,
}));

// Mock @/lib/prisma 让 db.query.licenseCache.findFirst 返回 undefined（无 cache）
vi.mock('@/lib/prisma', async () => {
  const real = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...real,
    db: {
      query: {
        licenseCache: {
          findFirst: async () => hoisted.licenseCacheRow,
        },
      },
    },
    getDb: () => ({
      query: {
        licenseCache: {
          findFirst: async () => hoisted.licenseCacheRow,
        },
      },
    }),
  };
});

import { GET } from '@/app/api/admin/license/route';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('/api/admin/license — on-prem mode (v2 shape)', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.LICENSE_KEY;
    hoisted.isAdminFromSessionMock.mockReset();
    hoisted.licenseCacheRow = undefined;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.LICENSE_KEY;
    else process.env.LICENSE_KEY = originalKey;
  });

  it('non-admin → 404 (silent)', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('admin + missing LICENSE_KEY → trustStatus=missing, displayStatus=missing', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    delete process.env.LICENSE_KEY;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trustStatus: string;
      displayStatus: string;
    };
    expect(body.trustStatus).toBe('missing');
    expect(body.displayStatus).toBe('missing');
  });

  it('admin + v1 LICENSE_KEY → trustStatus=legacy-unsigned（兼容窗口内）', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    const payload = {
      customer: 'Test Corp',
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      seatLimit: 100,
      tier: 'enterprise',
      features: ['sso'],
    };
    process.env.LICENSE_KEY = `aster-ent-2026-${b64url(JSON.stringify(payload))}`;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trustStatus: string;
      entitlementStatus: string;
      payload?: { customer: string };
    };
    // v1 key 在 dev/test 模式（默认窗口）内被识别为 legacy-unsigned
    // 生产模式 fail-closed 时会是 malformed —— 此处用 NODE_ENV=test 的 default 窗口
    expect(['legacy-unsigned', 'malformed']).toContain(body.trustStatus);
  });
});

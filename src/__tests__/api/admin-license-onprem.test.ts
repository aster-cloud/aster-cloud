// /api/admin/license on-prem 行为：
//   - 非 admin → 404 (silent)
//   - admin + missing LICENSE_KEY → status=missing
//   - admin + active LICENSE_KEY → 返回 parsed payload

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  isAdminFromSessionMock: vi.fn(),
}));

vi.mock('@/lib/deployment-mode', () => ({
  CAN_LICENSE: true, // on-prem
  IS_SAAS: false,
  IS_ONPREM: true,
}));

vi.mock('@/lib/admin-auth', () => ({
  isAdminFromSession: hoisted.isAdminFromSessionMock,
}));

import { GET } from '@/app/api/admin/license/route';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('/api/admin/license — on-prem mode', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.LICENSE_KEY;
    hoisted.isAdminFromSessionMock.mockReset();
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

  it('admin + missing LICENSE_KEY → status=missing', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    delete process.env.LICENSE_KEY;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('missing');
  });

  it('admin + valid future LICENSE_KEY → status=active', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    const payload = {
      customer: 'Test Corp',
      issuedAt: '2026-01-01T00:00:00.000Z',
      // Far-future expiry so the test stays active for years
      expiresAt: '2099-01-01T00:00:00.000Z',
      seatLimit: 100,
      tier: 'enterprise',
      features: ['sso'],
    };
    process.env.LICENSE_KEY = `aster-ent-2026-${b64url(JSON.stringify(payload))}`;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      payload?: { customer: string };
    };
    expect(body.status).toBe('active');
    expect(body.payload?.customer).toBe('Test Corp');
  });
});

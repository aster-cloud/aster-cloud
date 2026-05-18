// /api/admin/sso SaaS mode：CAN_SSO=false → 404

import { describe, it, expect, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  isAdminFromSessionMock: vi.fn(),
}));

vi.mock('@/lib/deployment-mode', () => ({
  CAN_SSO: false,
  IS_SAAS: true,
  IS_ONPREM: false,
}));

vi.mock('@/lib/admin-auth', () => ({
  isAdminFromSession: hoisted.isAdminFromSessionMock,
}));

import { GET } from '@/app/api/admin/sso/route';

describe('/api/admin/sso — SaaS mode', () => {
  it('returns 404 without calling isAdminFromSession', async () => {
    const res = await GET();
    expect(res.status).toBe(404);
    expect(hoisted.isAdminFromSessionMock).not.toHaveBeenCalled();
  });
});

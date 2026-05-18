// /api/admin/license SaaS mode：CAN_LICENSE=false → 404
//
// （on-prem 行为依赖 process.env.LICENSE_KEY + admin session — 集成测试
// 范围；这里只断"SaaS 不暴露端点"的安全不变量。）

import { describe, it, expect, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  isAdminFromSessionMock: vi.fn(),
}));

vi.mock('@/lib/deployment-mode', () => ({
  CAN_LICENSE: false, // SaaS
  IS_SAAS: true,
  IS_ONPREM: false,
}));

vi.mock('@/lib/admin-auth', () => ({
  isAdminFromSession: hoisted.isAdminFromSessionMock,
}));

import { GET } from '@/app/api/admin/license/route';

describe('/api/admin/license — SaaS mode', () => {
  it('returns 404 without calling isAdminFromSession', async () => {
    const res = await GET();
    expect(res.status).toBe(404);
    expect(hoisted.isAdminFromSessionMock).not.toHaveBeenCalled();
  });
});

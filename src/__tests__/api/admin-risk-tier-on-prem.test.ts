// /api/admin/risk-tier on-prem mode gate.
//
// SaaS 模式下的完整业务行为在 admin-risk-tier.test.ts 验证；本文件单测
// "on-prem 应返回 404，且 requireAdmin 不被调用" 这一不变量。
//
// 关键：CAN_RISKTIER 必须在 import route 模块之前被 mock，否则
// route 模块顶层 import 会捕获 build-time 值（默认 true）。

import { describe, it, expect, vi } from 'vitest';

// 用 vi.hoisted 让 mock 工厂能在 vi.mock 提升后引用 mock 函数。
const hoisted = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
}));

vi.mock('@/lib/deployment-mode', () => ({
  CAN_RISKTIER: false,
  IS_SAAS: false,
  IS_ONPREM: true,
}));

vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: hoisted.requireAdminMock,
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: { users: { findMany: vi.fn(), findFirst: vi.fn() } },
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

import { GET, POST, HEAD } from '@/app/api/admin/risk-tier/route';

function mockRequest(url = 'http://localhost/api/admin/risk-tier', method = 'GET', body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('/api/admin/risk-tier — on-prem mode', () => {
  it('GET returns 404 without calling requireAdmin', async () => {
    const res = await GET(mockRequest());
    expect(res.status).toBe(404);
    expect(hoisted.requireAdminMock).not.toHaveBeenCalled();
  });

  it('POST returns 404 without calling requireAdmin', async () => {
    const res = await POST(
      mockRequest(undefined, 'POST', { userId: 'u', newTier: 0 }),
    );
    expect(res.status).toBe(404);
    expect(hoisted.requireAdminMock).not.toHaveBeenCalled();
  });

  it('HEAD returns 404 without calling requireAdmin', async () => {
    const res = await HEAD();
    expect(res.status).toBe(404);
    expect(hoisted.requireAdminMock).not.toHaveBeenCalled();
  });
});

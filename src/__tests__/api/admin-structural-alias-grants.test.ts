// admin 结构词别名授权接口（ADR 0022 结构词扩展）POST 幂等性测试。
//
// W3 修复后：DB 层 partial UNIQUE(userId) WHERE revokedAt IS NULL 兜住 admin POST 的
// check-then-insert 并发窗口。本测试钉住接口对唯一冲突的优雅处理——重复/并发授予返回
// 幂等成功，而非 500。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/license-write-gate', () => ({ requireLicenseWriteOk: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  db: {
    query: { structuralAliasGrants: { findFirst: vi.fn() } },
    insert: vi.fn(),
  },
  structuralAliasGrants: { userId: {}, revokedAt: {} },
  users: {},
}));

import { POST } from '@/app/api/admin/structural-alias-grants/route';
import { requireAdmin } from '@/lib/admin-auth';
import { requireLicenseWriteOk } from '@/lib/license-write-gate';
import { db } from '@/lib/prisma';

function req(body: unknown) {
  return new Request('http://localhost/api/admin/structural-alias-grants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/admin/structural-alias-grants — 授予幂等', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireLicenseWriteOk).mockResolvedValue(null);
    vi.mocked(requireAdmin).mockResolvedValue({ userId: 'admin-1' } as never);
  });

  it('userId 缺失 → 400', async () => {
    const r = await POST(req({}));
    expect(r.status).toBe(400);
  });

  it('无活跃授权时插入新授权 → ok', async () => {
    vi.mocked(db.query.structuralAliasGrants.findFirst).mockResolvedValue(undefined as never);
    const values = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const r = await POST(req({ userId: 'user-9' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(values).toHaveBeenCalled();
  });

  it('已有活跃授权 → 幂等成功，不重复插入', async () => {
    vi.mocked(db.query.structuralAliasGrants.findFirst).mockResolvedValue({ id: 'g1' } as never);
    const values = vi.fn();
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const r = await POST(req({ userId: 'user-9' }));
    expect(r.status).toBe(200);
    expect(values).not.toHaveBeenCalled();
  });

  it('并发竞态：唯一冲突(23505)被捕获 → 幂等成功而非 500', async () => {
    // findFirst 看不到（并发另一请求尚未提交），insert 撞 W3 唯一索引抛 23505。
    vi.mocked(db.query.structuralAliasGrants.findFirst).mockResolvedValue(undefined as never);
    const values = vi.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const r = await POST(req({ userId: 'user-9' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('非唯一冲突的 DB 错误仍冒泡（不静默吞）', async () => {
    vi.mocked(db.query.structuralAliasGrants.findFirst).mockResolvedValue(undefined as never);
    const values = vi.fn().mockRejectedValue(Object.assign(new Error('connection reset'), { code: '08006' }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await expect(POST(req({ userId: 'user-9' }))).rejects.toThrow('connection reset');
  });
});

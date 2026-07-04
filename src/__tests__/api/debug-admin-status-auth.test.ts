// debug/admin-status 鉴权门测试（审计 #168）。
//
// 修复：密钥从 query string（会泄露到访问日志/Referer/历史）改为 X-Debug-Secret 请求头，
// 且用常量时间比较。本测试钉住：①未配置 DEBUG_SECRET → 503 ②缺/错 header → 403
// ③query string 里的 secret 不再被接受（旧向量已关闭）。正确密钥的成功路径依赖 DB bootstrap，
// 不在本单元测试范围（mock db-bootstrap 抛错以证明"鉴权通过后才触碰 DB"）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db-bootstrap', () => ({
  ensureSchemaApplied: vi.fn(async () => {
    throw new Error('DB should not be reached before auth passes');
  }),
  ensureAdminSeeded: vi.fn(async () => {}),
}));
vi.mock('@/lib/prisma', () => ({
  getDb: vi.fn(() => ({ execute: vi.fn(), query: { users: { findFirst: vi.fn() } } })),
  users: {},
}));
vi.mock('@/auth', () => ({ verifyPassword: vi.fn() }));

import { GET } from '@/app/api/debug/admin-status/route';

function req(headers: Record<string, string> = {}, url = 'http://localhost/api/debug/admin-status') {
  return new Request(url, { method: 'GET', headers }) as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/debug/admin-status — 鉴权门（审计 #168）', () => {
  const OLD = process.env.DEBUG_SECRET;
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => {
    if (OLD === undefined) delete process.env.DEBUG_SECRET;
    else process.env.DEBUG_SECRET = OLD;
  });

  it('DEBUG_SECRET 未配置 → 503', async () => {
    delete process.env.DEBUG_SECRET;
    const r = await GET(req());
    expect(r.status).toBe(503);
  });

  it('缺 X-Debug-Secret 头 → 403', async () => {
    process.env.DEBUG_SECRET = 'sekret';
    const r = await GET(req());
    expect(r.status).toBe(403);
  });

  it('X-Debug-Secret 头错误 → 403', async () => {
    process.env.DEBUG_SECRET = 'sekret';
    const r = await GET(req({ 'x-debug-secret': 'wrong' }));
    expect(r.status).toBe(403);
  });

  it('★旧向量关闭：query string ?secret= 不再被接受 → 403', async () => {
    process.env.DEBUG_SECRET = 'sekret';
    const r = await GET(req({}, 'http://localhost/api/debug/admin-status?secret=sekret'));
    expect(r.status).toBe(403);
  });

  it('正确头 → 通过鉴权（随后触碰 DB，被 mock 抛错证明已越过 403）', async () => {
    process.env.DEBUG_SECRET = 'sekret';
    // 鉴权通过后走到 ensureSchemaApplied（mock 抛错）→ 不是 403。
    await expect(GET(req({ 'x-debug-secret': 'sekret' }))).rejects.toThrow(
      'DB should not be reached before auth passes',
    );
  });
});

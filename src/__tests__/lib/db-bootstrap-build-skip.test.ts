// db-bootstrap build 期短路测试（issue #191）。
//
// 现象：`next build` / opennext 预渲染阶段无 Hyperdrive binding、也无 DATABASE_URL，
// 冷启动自愈被 (dashboard)/layout 顺带触发时会逐条 DDL 抛 "connection string not found"
// 刷屏。修复：入口用 hasDbBinding() 判定，无 DB 来源时安静短路。
//
// 本测试钉住：
//   ① 无 DB binding → ensureSchemaApplied/ensureAdminSeeded 直接 resolve，绝不触碰 getDb()
//      （即不会抛错、不会尝试任何 DDL）——build 日志因此不再刷屏。
//   ② 有 DB binding → 恢复原逻辑，会调用 getDb()（运行时冷启动自愈不受影响）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// spies 用 vi.hoisted 提升，才能被 hoist 到顶部的 vi.mock 工厂引用。
// getDb 一旦被调用就抛错，用于证明短路时根本没走到 DB 层。
const { getDbSpy, hasDbBindingSpy } = vi.hoisted(() => ({
  getDbSpy: vi.fn(() => {
    throw new Error('getDb() 不该在 build 期被调用');
  }),
  hasDbBindingSpy: vi.fn<() => boolean>(),
}));

vi.mock('@/db', () => ({
  getDb: getDbSpy,
  hasDbBinding: hasDbBindingSpy,
}));

import {
  ensureSchemaApplied,
  ensureAdminSeeded,
} from '@/lib/db-bootstrap';

describe('db-bootstrap — build 期无 DB binding 时安静短路（issue #191）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无 DB binding → ensureSchemaApplied 直接 resolve，不触碰 getDb()', async () => {
    hasDbBindingSpy.mockReturnValue(false);
    await expect(ensureSchemaApplied()).resolves.toBeUndefined();
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it('无 DB binding → ensureAdminSeeded 直接 resolve，不触碰 getDb()', async () => {
    hasDbBindingSpy.mockReturnValue(false);
    await expect(ensureAdminSeeded()).resolves.toBeUndefined();
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it('有 DB binding → 恢复原逻辑，会调用 getDb()（运行时自愈不受影响）', async () => {
    hasDbBindingSpy.mockReturnValue(true);
    // getDb 被 mock 抛错——这里只需证明"短路解除后确实走到了 DB 层"，
    // 故 schema patch 的 catch 会吞掉该错误并 resolve，但 getDb 已被调用。
    await ensureSchemaApplied();
    expect(getDbSpy).toHaveBeenCalled();
  });
});

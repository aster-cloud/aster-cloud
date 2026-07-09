// hasDbBinding() env 判定矩阵测试（issue #191 — Codex 审查 #5）。
//
// hasDbBinding() 是 db-bootstrap 短路的判定依据，必须与 getConnectionString()
// 的"可用连接串"口径严格一致，否则会漂移出"运行时其实有 DB 却被误判为无、
// 自愈被跳过"的假阴性。本测试直接钉住真实判定（不 mock hasDbBinding 本身）。
//
// ⚠️ 测试边界：hasDbBinding() 的 Hyperdrive 分支走 getCloudflareEnvSync()，
// 后者用 CommonJS `require('@opennextjs/cloudflare')`（非 import）。vitest 的
// vi.mock 不拦截该 require，所以测试环境里 Cloudflare 上下文恒为 null——
// Hyperdrive-binding 正向路径无法在此单测覆盖（不为测试而把生产源码 require
// 改 import）。因此这里覆盖的是**不依赖 CF 上下文的 env 判定**（DATABASE_URL /
// HYPERDRIVE_DATABASE_URL / 全空），这也正是 build 期短路真正依赖的分支
// （build 期没有 Cloudflare 上下文，判定完全落在 process.env）。Hyperdrive
// 正向路径由生产运行时 + #187 那次 run 的端到端 sync 证明。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { hasDbBinding } from '@/db';

describe('hasDbBinding() — env 判定（issue #191）', () => {
  const OLD_HYPERDRIVE = process.env.HYPERDRIVE_DATABASE_URL;
  const OLD_DATABASE = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.HYPERDRIVE_DATABASE_URL;
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (OLD_HYPERDRIVE === undefined) delete process.env.HYPERDRIVE_DATABASE_URL;
    else process.env.HYPERDRIVE_DATABASE_URL = OLD_HYPERDRIVE;
    if (OLD_DATABASE === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = OLD_DATABASE;
  });

  it('build 期典型态：无 Cloudflare 上下文 + 无任何 env → false（触发短路）', () => {
    expect(hasDbBinding()).toBe(false);
  });

  it('本地/集成：DATABASE_URL 设置 → true', () => {
    process.env.DATABASE_URL = 'postgres://localhost/db';
    expect(hasDbBinding()).toBe(true);
  });

  it('HYPERDRIVE_DATABASE_URL 设置（本地覆盖）→ true', () => {
    process.env.HYPERDRIVE_DATABASE_URL = 'postgres://hyperdrive-local/db';
    expect(hasDbBinding()).toBe(true);
  });

  it('★DATABASE_URL 空串 → false（与 getConnectionString 同源：空串不算可用连接串）', () => {
    process.env.DATABASE_URL = '';
    expect(hasDbBinding()).toBe(false);
  });
});

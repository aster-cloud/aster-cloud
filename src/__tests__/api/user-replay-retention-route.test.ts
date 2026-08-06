// 回放明文授权开关端点测试（第九轮 P0-8）。
//
// 这个字段此前**没有任何写入口**（UI/API 皆无），等于依赖它的 What-if
// 永远无法自助开启。本文件锁住：鉴权、只改自己那行、布尔严格性。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

const captured = vi.hoisted(() => ({ where: undefined as unknown, set: undefined as unknown }));
const rowSets = vi.hoisted(() => ({
  user: [] as unknown[],
  updated: [] as unknown[],
}));

vi.mock('@/lib/prisma', () => {
  const selectChain = {
    from: () => selectChain,
    where: (w: unknown) => {
      captured.where = w;
      return selectChain;
    },
    limit: () => Promise.resolve(rowSets.user),
  };
  const updateChain = {
    set: (v: unknown) => {
      captured.set = v;
      return updateChain;
    },
    where: (w: unknown) => {
      captured.where = w;
      return updateChain;
    },
    // ★returning：route 据此判断是否真的写入了（零行 = 用户不存在）
    returning: () => Promise.resolve(rowSets.updated),
  };
  return {
    db: { select: () => selectChain, update: () => updateChain },
    users: new Proxy({}, { get: (_t, p) => `users.${String(p)}` }),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}));

const { GET, PATCH } = await import('@/app/api/user/replay-retention/route');

const patchReq = (body: unknown) =>
  new NextRequest('https://x.test/api/user/replay-retention', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('/api/user/replay-retention', () => {
  beforeEach(() => {
    captured.where = undefined;
    captured.set = undefined;
    rowSets.user = [{ enabled: false }];
    rowSets.updated = [{ enabled: true }];
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'u1' } });
  });

  it('未登录 → 401（GET 与 PATCH 都是）', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await PATCH(patchReq({ enabled: true }))).status).toBe(401);
  });

  it('GET 返回当前状态', async () => {
    rowSets.user = [{ enabled: true }];
    const body = await (await GET()).json();
    expect(body.enabled).toBe(true);
  });

  it('★查不到用户行按未授权处理（fail-closed，不猜默认值）', async () => {
    rowSets.user = [];
    const body = await (await GET()).json();
    expect(body.enabled).toBe(false);
  });

  it('PATCH 写入并回显', async () => {
    const res = await PATCH(patchReq({ enabled: true }));
    expect(res.status).toBe(200);
    // ★回读落库值而非回显请求值
    expect((await res.json()).enabled).toBe(true);
    expect(captured.set).toEqual({ replayRetentionEnabled: true });
  });

  it('★update 必须带 userId（否则改全表）', async () => {
    await PATCH(patchReq({ enabled: true }));
    expect(captured.where).toEqual({ op: 'eq', col: 'users.id', val: 'u1' });
  });

  it.each([
    ['字符串 "true"', 'true'],
    ['数字 1', 1],
    ['数字 0', 0],
    ['null', null],
    ['缺字段', {}],
  ])('★非布尔 %s → 400（授权开关不接受模糊真值）', async (_l, v) => {
    const body = typeof v === 'object' && v !== null ? v : { enabled: v };
    const res = await PATCH(patchReq(body));
    expect(res.status).toBe(400);
  });

  it('非法 JSON → 400', async () => {
    expect((await PATCH(patchReq('{bad'))).status).toBe(400);
  });

  it('可以关闭（不是只写不读的单向开关）', async () => {
    rowSets.updated = [{ enabled: false }];
    const res = await PATCH(patchReq({ enabled: false }));
    expect((await res.json()).enabled).toBe(false);
    expect(captured.set).toEqual({ replayRetentionEnabled: false });
  });

  it('★零行更新 → 404，不得假装成功', async () => {
    // 用户行不存在时静默返回 200 会让前端显示「已开启」，实际什么都没写
    rowSets.updated = [];
    const res = await PATCH(patchReq({ enabled: true }));
    expect(res.status).toBe(404);
  });
});

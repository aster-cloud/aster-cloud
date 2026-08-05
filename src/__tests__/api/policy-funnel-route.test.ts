// 条件漏斗端点测试（Phase 1）。
//
// ★重点是**租户隔离**：本仓历史上多次出现"只按资源 id 查、忘了带 userId"
// 导致的跨租户读（见 audit-crosstenant-2026-07）。这里不满足于"mock 返回空"，
// 而是捕获真实传给 where() 的条件，断言 userId 过滤确实存在——
// 否则 mock 掉 db 的测试对这类 bug 完全无感。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

/** 捕获每次 select().from().where() 的调用参数，供断言。 */
const captured: { table: unknown; where: unknown }[] = [];
let ownedRows: unknown[] = [];
let execRows: unknown[] = [];
/** count() 查询返回的总数——用于断言 truncated 口径 */
let totalCount = 0;

vi.mock('@/lib/prisma', () => {
  const makeChain = (rowsFor: () => unknown[]) => ({
    from(table: unknown) {
      const ctx: { table: unknown; where: unknown } = { table, where: undefined };
      captured.push(ctx);
      const chain = {
        where(w: unknown) {
          ctx.where = w;
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit() {
          return Promise.resolve(rowsFor());
        },
        then(res: (v: unknown[]) => unknown) {
          return Promise.resolve(rowsFor()).then(res);
        },
      };
      return chain;
    },
  });
  return {
    db: {
      select: () =>
        makeChain(() => {
          // 三次查询依次是：归属校验 → 执行行 → count(总数)
          if (captured.length <= 1) return ownedRows;
          if (captured.length === 2) return execRows;
          return [{ value: totalCount }];
        }),
    },
    policies: { id: 'policies.id', userId: 'policies.userId' },
    executions: {
      policyId: 'executions.policyId',
      userId: 'executions.userId',
      createdAt: 'executions.createdAt',
      policyVersion: 'executions.policyVersion',
      traceSkeletonJson: 'executions.traceSkeletonJson',
    },
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...xs: unknown[]) => ({ op: 'and', xs }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  gte: (col: unknown, val: unknown) => ({ op: 'gte', col, val }),
  lte: (col: unknown, val: unknown) => ({ op: 'lte', col, val }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  sql: () => ({ op: 'sql' }),
  count: () => ({ op: 'count' }),
}));

const { GET } = await import('@/app/api/policies/[id]/funnel/route');

const req = (qs = '') =>
  new NextRequest(`https://x.test/api/policies/p1/funnel${qs}`);
const params = Promise.resolve({ id: 'p1' });

/** 把嵌套 and/eq 结构拍平，便于断言某个过滤条件是否存在。 */
function flatten(node: unknown): { col: unknown; val: unknown }[] {
  const out: { col: unknown; val: unknown }[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.op === 'and') (o.xs as unknown[]).forEach(walk);
    else if (o.col !== undefined) out.push({ col: o.col, val: o.val });
  };
  walk(node);
  return out;
}

const skel = (steps: Array<[string, string, boolean, number]>) => ({
  schemaVersion: 'trace-skeleton/v1',
  steps: steps.map(([stepId, expression, matched, depth]) => ({
    stepId,
    expression,
    matched,
    depth,
  })),
});

beforeEach(() => {
  captured.length = 0;
  ownedRows = [{ id: 'p1' }];
  execRows = [];
  getSession.mockResolvedValue({ user: { id: 'u1' } });
});

describe('GET /api/policies/:id/funnel', () => {
  it('未登录 → 401', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET(req(), { params })).status).toBe(401);
  });

  it('★策略不属于当前用户 → 404（不泄露存在性）', async () => {
    ownedRows = [];
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it('★归属查询带 userId 过滤（防跨租户读）', async () => {
    await GET(req(), { params });
    const conds = flatten(captured[0].where);
    expect(conds).toContainEqual({ col: 'policies.id', val: 'p1' });
    expect(conds).toContainEqual({ col: 'policies.userId', val: 'u1' });
  });

  it('★执行查询同样带 userId 过滤（不能只按 policyId）', async () => {
    await GET(req(), { params });
    const conds = flatten(captured[1].where);
    expect(conds).toContainEqual({ col: 'executions.policyId', val: 'p1' });
    expect(conds).toContainEqual({ col: 'executions.userId', val: 'u1' });
  });

  it('聚合骨架并返回漏斗', async () => {
    execRows = [
      { skeleton: skel([['0.1', 'VIP', true, 0]]) },
      { skeleton: skel([['0.1', 'VIP', false, 0]]) },
    ];
    const body = await (await GET(req(), { params })).json();
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]).toMatchObject({ evaluated: 2, matched: 1 });
  });

  it('★coverage 诚实反映骨架采集率（不静默）', async () => {
    execRows = [{ skeleton: skel([['0.1', 'A', true, 0]]) }, { skeleton: null }];
    const body = await (await GET(req(), { params })).json();
    expect(body.sampleSize).toBe(2);
    expect(body.withSkeleton).toBe(1);
    expect(body.coverage).toBe(0.5);
  });

  it('★口径说明随响应返回（UI 需常驻展示）', async () => {
    const body = await (await GET(req(), { params })).json();
    expect(body.sampleNote).toBeTruthy();
  });

  it('limit 被钳制在上限内（防打爆 Worker）', async () => {
    const body = await (await GET(req('?limit=99999'), { params })).json();
    expect(body.limit).toBe(2000);
  });

  it('limit 非法值回落默认', async () => {
    const body = await (await GET(req('?limit=abc'), { params })).json();
    expect(body.limit).toBe(500);
  });

  it('version 参数转成数值过滤', async () => {
    await GET(req('?version=3'), { params });
    expect(flatten(captured[1].where)).toContainEqual({
      col: 'executions.policyVersion',
      val: 3,
    });
  });

  // ★截断口径必须随响应返回。没有它，「这条件从未命中」会被读成结论，
  // 而实际可能只是它没赶上最近这批样本（第四轮交叉审查）。
  it('★总数大于扫描数时回报 truncated', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    ownedRows = [{ id: 'p1' }];
    execRows = [
      { skeleton: { steps: [{ stepId: '0.1', expression: 'if condition', matched: false, depth: 0 }] } },
    ];
    totalCount = 5000;

    const res = await GET(req(''), { params });
    const body = await res.json();
    expect(body.scanned).toBe(1);
    expect(body.total).toBe(5000);
    expect(body.truncated).toBe(true);
    // 同时确认字段名不再暗示「死分支」
    expect(body.neverMatchedInSample).toHaveLength(1);
    expect(body.deadBranches).toBeUndefined();
  });

  it('总数等于扫描数时 truncated=false（这就是全部）', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    ownedRows = [{ id: 'p1' }];
    execRows = [{ skeleton: { steps: [{ stepId: '0.1', expression: 'x', matched: true, depth: 0 }] } }];
    totalCount = 1;

    const res = await GET(req(''), { params });
    const body = await res.json();
    expect(body.truncated).toBe(false);
  });
});

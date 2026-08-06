// What-if 端点测试（Phase 4，ADR 0033 接回后）。
//
// 覆盖四条防线，每条都对应一个「静默出错」的失败模式：
//   1. 显式授权开关 —— 未开 replayRetentionEnabled 一律 403，不静默降级
//   2. 租户隔离 —— 归属校验与执行查询都必须带 userId
//   3. 双判门槛 —— 条数或代表性比例不够就不给数字，两个 reason 分开
//   4. 重跑失败不当决策 —— 失败计入 replayFailed，不能算成「决策未变」
//
// 真库 + 真重跑由集成测试覆盖；这里验的是控制流与口径。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

const evaluateSource = vi.hoisted(() => vi.fn());
vi.mock('@/services/policy/policy-api', () => ({
  createPolicyApiClient: () => ({ evaluateSource }),
}));

const captured = vi.hoisted(() => [] as { where: unknown }[]);
const rowSets = vi.hoisted(() => ({
  owned: [] as unknown[],
  user: [] as unknown[],
  version: [] as unknown[],
  base: [] as unknown[],
  totalCount: 0,
}));

vi.mock('@/lib/prisma', () => {
  // 五次查询依次是：归属校验 → users 开关 → PolicyVersion → count(总数) → 基线执行
  let call = 0;
  const rowsFor = () => {
    const n = call++;
    if (n === 0) return rowSets.owned;
    if (n === 1) return rowSets.user;
    if (n === 2) return rowSets.version;
    // ★sampleSize 来自独立 count 查询（全量），不再是 base.length
    if (n === 3) return [{ value: rowSets.totalCount }];
    return rowSets.base;
  };
  const makeChain = () => {
    const ctx: { where: unknown } = { where: undefined };
    captured.push(ctx);
    const chain = {
      leftJoin: () => chain,
      where(w: unknown) {
        ctx.where = w;
        return chain;
      },
      orderBy: () => chain,
      limit: () => Promise.resolve(rowsFor()),
      then: (res: (v: unknown[]) => unknown) => Promise.resolve(rowsFor()).then(res),
    };
    return chain;
  };
  const tbl = new Proxy({}, { get: (_t, p) => `col.${String(p)}` });
  return {
    db: { select: () => ({ from: () => makeChain() }) },
    policies: tbl,
    executions: tbl,
    executionOutcomes: tbl,
    policyVersions: tbl,
    users: tbl,
    __resetCall: () => {
      call = 0;
    },
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...xs: unknown[]) => ({ op: 'and', xs }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  desc: (c: unknown) => ({ op: 'desc', c }),
  isNotNull: (c: unknown) => ({ op: 'isNotNull', c }),
  count: () => ({ op: 'count' }),
}));

const { GET } = await import('@/app/api/policies/[id]/whatif/route');
const prisma = await import('@/lib/prisma');

const params = Promise.resolve({ id: 'p1' });
const req = (qs = 'baseVersion=1&targetVersion=2') =>
  new NextRequest(`http://localhost/api/policies/p1/whatif?${qs}`);

function eqPairs(node: unknown, acc: string[] = []): string[] {
  if (!node || typeof node !== 'object') return acc;
  const n = node as { op?: string; xs?: unknown[]; col?: unknown; val?: unknown };
  if (n.op === 'eq') acc.push(`${String(n.col)}=${String(n.val)}`);
  if (Array.isArray(n.xs)) n.xs.forEach((x) => eqPairs(x, acc));
  return acc;
}

/** 造 n 条 REPLAYABLE 基线执行（默认全部 approved 且有正面 outcome）。 */
function baseRows(n: number, over: Record<string, unknown> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    executionId: `e${i}`,
    decision: 'approved',
    input: { score: 600 + i },
    locale: 'en',
    functionName: 'assess',
    aliasSetJson: null,
    replayabilityStatus: 'REPLAYABLE',
    outcome: 'converted',
    value: '100.0000',
    ...over,
  }));
}

describe('GET /api/policies/:id/whatif', () => {
  beforeEach(() => {
    captured.length = 0;
    rowSets.owned = [{ id: 'p1' }];
    rowSets.user = [{ replayRetentionEnabled: true }];
    rowSets.version = [{ source: 'Module M. Rule assess...', content: null, aliasSet: null }];
    rowSets.base = baseRows(50);
    rowSets.totalCount = 50;
    getSession.mockReset();
    evaluateSource.mockReset();
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    // 默认：重跑全部成功且全部翻成 denied
    evaluateSource.mockResolvedValue({ result: 'REJECTED', error: null, executionTimeMs: 1 });
    (prisma as unknown as { __resetCall: () => void }).__resetCall();
  });

  it('未登录 → 401', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET(req(), { params })).status).toBe(401);
  });

  it('不是自己的策略 → 404（不泄露存在性）', async () => {
    rowSets.owned = [];
    expect((await GET(req(), { params })).status).toBe(404);
  });

  it('★归属校验必须带 userId', async () => {
    await GET(req(), { params });
    expect(eqPairs(captured[0]?.where)).toContain('col.id=p1');
    expect(eqPairs(captured[0]?.where).some((p) => p.endsWith('=u1'))).toBe(true);
  });

  describe('★显式授权开关（本端点读明文业务输入）', () => {
    it('未开 replayRetentionEnabled → 403，且不做任何重跑', async () => {
      rowSets.user = [{ replayRetentionEnabled: false }];
      const res = await GET(req(), { params });
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error.code).toBe('REPLAY_RETENTION_DISABLED');
      // ★不能静默降级成空结果——那会让用户以为功能坏了
      expect(evaluateSource).not.toHaveBeenCalled();
    });

    it('查不到用户行时按未授权处理（fail-closed）', async () => {
      rowSets.user = [];
      expect((await GET(req(), { params })).status).toBe(403);
    });
  });

  describe('参数校验', () => {
    it.each([
      ['非整数', 'baseVersion=x&targetVersion=2'],
      ['缺参数', 'targetVersion=2'],
      ['版本 0', 'baseVersion=0&targetVersion=2'],
      ['超 int4', 'baseVersion=999999999999999999999&targetVersion=2'],
      ['两版本相同', 'baseVersion=2&targetVersion=2'],
    ])('%s → 400', async (_l, qs) => {
      expect((await GET(req(qs), { params })).status).toBe(400);
    });

    it('目标版本无源码 → 404', async () => {
      rowSets.version = [];
      const res = await GET(req(), { params });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('VERSION_NOT_FOUND');
    });
  });

  describe('★双判门槛：条数 + 代表性比例', () => {
    it('可重跑条数不足 → INSUFFICIENT_REPLAYED，不给数字', async () => {
      rowSets.base = baseRows(10); // < MIN_REPLAYED(30)
      rowSets.totalCount = 10;
      const body = await (await GET(req(), { params })).json();

      expect(body.comparable).toBe(false);
      expect(body.reason).toBe('INSUFFICIENT_REPLAYED');
      // 一个会被读成结论的数字都不能有
      expect(body.changed).toBeUndefined();
      expect(body.estimatedValueDelta).toBeUndefined();
    });

    it('★大分母 + 小样本 → INSUFFICIENT_COVERAGE（绝对条数够也不行）', async () => {
      // 250 条基线里只有 35 条 REPLAYABLE：条数过了 30，但占比仅 14% < 20%。
      // ★REPLAYABLE 过滤已下推到 SQL，故 base 只返回可重跑的那 35 条；
      //   总量由独立 count 查询给出。
      rowSets.base = baseRows(35);
      rowSets.totalCount = 250;
      const body = await (await GET(req(), { params })).json();

      expect(body.comparable).toBe(false);
      expect(body.reason).toBe('INSUFFICIENT_COVERAGE');
      expect(body.replayed).toBe(35);
      expect(body.sampleSize).toBe(250);
      expect(body.coverage).toBeCloseTo(0.14, 2);
      expect(body.changed).toBeUndefined();
    });

    it('两条都满足 → 给出估算，并回报口径', async () => {
      const body = await (await GET(req(), { params })).json();

      expect(body.comparable).toBe(true);
      expect(body.replayed).toBe(50);
      expect(body.coverage).toBe(1);
      // 50 条 approved 全被目标版本判成 denied
      expect(body.newlyRejected).toBe(50);
    });
  });

  describe('★重跑失败不得当成「决策未变」', () => {
    it('promise reject 计入 replayFailed，不进 newDecisions', async () => {
      evaluateSource.mockRejectedValue(new Error('boom'));
      const body = await (await GET(req(), { params })).json();

      expect(body.replayFailed).toBe(50);
      expect(body.replayed).toBe(0);
      expect(body.comparable).toBe(false);
    });

    it('★resolve 但 error 非空同样算失败（编译失败/函数名不符）', async () => {
      evaluateSource.mockResolvedValue({ result: null, error: 'compile failed', executionTimeMs: 1 });
      const body = await (await GET(req(), { params })).json();

      // 若把它当成决策，会被算进 changed，系统性歪曲结论
      expect(body.replayFailed).toBe(50);
      expect(body.replayed).toBe(0);
    });
  });

  it('★REPLAYABLE 过滤下推到 SQL（不是查回来再 filter）', async () => {
    // 旧写法 LIMIT 取最近 N 条再 filter：近期恰好多为 NON_REPLAYABLE 时，
    // 可重跑条数会塌到接近 0，即便库里有几千条可重跑历史（真库 E2E 实测过）。
    await GET(req(), { params });
    const where = captured[4]?.where; // 第 5 次查询 = 基线执行
    expect(eqPairs(where)).toContain('col.replayabilityStatus=REPLAYABLE');
  });

  it('input 为 null 的行不参与重跑（没有输入就没法重跑）', async () => {
    rowSets.base = [...baseRows(30), ...baseRows(5, { input: null })];
    rowSets.totalCount = 35;
    await GET(req(), { params });
    expect(evaluateSource).toHaveBeenCalledTimes(30);
  });
});

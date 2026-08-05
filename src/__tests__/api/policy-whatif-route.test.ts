// What-if 端点测试（Phase 4）。
//
// ★重点有二：
//   1. 租户隔离——与漏斗同理，捕获真实 where 条件断言 userId 过滤存在。
//   2. **决策取值大小写**：DB enum 是小写 'approved'，而 estimateWhatIf 的默认值
//      是大写 'APPROVED'。route 若不显式传 approveDecisions，所有样本都会被判成
//      「未放行」，基线恒空，端点静默返回一个毫无意义的 insufficient——不报错、
//      不告警。这类"看起来能跑"的缺陷正是 mock 测试最容易放过的，故专门断言。
//
// SQL 语义层（unique 约束、NULL 比较、numeric 精度）由
// src/__tests__/integration/strategy-replay-analytics.integration.test.ts
// 用真实 Postgres 覆盖——mock 测不了那些。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

const captured: { where: unknown }[] = [];
let ownedRows: unknown[] = [];
let baseRows: unknown[] = [];
let targetRows: unknown[] = [];

vi.mock('@/lib/prisma', () => {
  // 三次查询依次是：归属校验 → 基线（带 leftJoin）→ 目标版本
  let call = 0;
  const rowsFor = () => {
    const n = call++;
    return n === 0 ? ownedRows : n === 1 ? baseRows : targetRows;
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
  return {
    db: {
      select: () => ({ from: () => makeChain() }),
    },
    policies: { id: 'policies.id', userId: 'policies.userId' },
    executions: {
      id: 'executions.id',
      policyId: 'executions.policyId',
      userId: 'executions.userId',
      decision: 'executions.decision',
      policyVersion: 'executions.policyVersion',
      createdAt: 'executions.createdAt',
    },
    executionOutcomes: {
      executionId: 'executionOutcomes.executionId',
      outcome: 'executionOutcomes.outcome',
      value: 'executionOutcomes.value',
    },
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
}));

const { GET } = await import('@/app/api/policies/[id]/whatif/route');
const prisma = await import('@/lib/prisma');

const params = Promise.resolve({ id: 'p1' });
const req = (qs: string) => new NextRequest(`http://localhost/api/policies/p1/whatif?${qs}`);

/** 递归找出 where 树里所有 eq(col, val) 组合，供隔离断言。 */
function eqPairs(node: unknown, acc: string[] = []): string[] {
  if (!node || typeof node !== 'object') return acc;
  const n = node as { op?: string; xs?: unknown[]; col?: unknown; val?: unknown };
  if (n.op === 'eq') acc.push(`${String(n.col)}=${String(n.val)}`);
  if (Array.isArray(n.xs)) n.xs.forEach((x) => eqPairs(x, acc));
  return acc;
}

describe('GET /api/policies/:id/whatif', () => {
  beforeEach(() => {
    captured.length = 0;
    ownedRows = [{ id: 'p1' }];
    baseRows = [];
    targetRows = [];
    getSession.mockReset();
    (prisma as unknown as { __resetCall: () => void }).__resetCall();
  });

  it('未登录 → 401', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req('baseVersion=1&targetVersion=2'), { params });
    expect(res.status).toBe(401);
  });

  it('不是自己的策略 → 404（不泄露存在性）', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    ownedRows = [];
    const res = await GET(req('baseVersion=1&targetVersion=2'), { params });
    expect(res.status).toBe(404);
  });

  it('★归属校验必须带 userId（跨租户读防线）', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    await GET(req('baseVersion=1&targetVersion=2'), { params });
    expect(eqPairs(captured[0]?.where)).toContain('policies.userId=u1');
  });

  it('★基线与目标查询都必须带 userId', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    await GET(req('baseVersion=1&targetVersion=2'), { params });
    expect(eqPairs(captured[1]?.where)).toContain('executions.userId=u1');
    expect(eqPairs(captured[2]?.where)).toContain('executions.userId=u1');
  });

  it('版本参数非整数 → 400', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(req('baseVersion=x&targetVersion=2'), { params });
    expect(res.status).toBe(400);
  });

  it('缺少版本参数 → 400', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(req('targetVersion=2'), { params });
    expect(res.status).toBe(400);
  });

  it('两个版本相同 → 400（无可比较的变化）', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(req('baseVersion=2&targetVersion=2'), { params });
    expect(res.status).toBe(400);
  });

  it('★决策用小写 approved 时基线必须成立（大小写口径对齐 DB enum）', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    // 40 条历史通过 + 有结局，足以越过 MIN_FOR_ESTIMATE(30)
    baseRows = Array.from({ length: 40 }, (_, i) => ({
      executionId: `e${i}`,
      decision: 'approved', // ← DB enum 是小写
      outcome: 'converted',
      value: '10.0000',
    }));
    // ★用**相同** executionId：只有回放过的执行才可比（见 route 的对齐检查）
    targetRows = (baseRows as { executionId: string }[]).map((r) => ({
      executionId: r.executionId,
      decision: 'denied',
    }));

    const res = await GET(
      req('baseVersion=1&targetVersion=2&positiveOutcomes=converted&negativeOutcomes=defaulted'),
      { params },
    );
    const body = await res.json();

    // 若 route 漏传 approveDecisions，这里会是 null / insufficient
    expect(body.baselinePositiveRate).toBe(1);
    expect(body.confidence).not.toBe('insufficient');
    // 40 条全部由 approved 变 denied
    expect(body.newlyRejected).toBe(40);
  });

  it('numeric 字符串被转成 number 参与估算', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    baseRows = [
      { executionId: 'e1', decision: 'approved', outcome: 'converted', value: '12.5000' },
    ];
    // 需要至少一条对齐才会走到估算分支（否则是 comparable:false）
    targetRows = [{ executionId: 'e1', decision: 'approved' }];
    const res = await GET(req('baseVersion=1&targetVersion=2&positiveOutcomes=converted'), {
      params,
    });
    const body = await res.json();
    expect(body.baselineAvgValue).toBe(12.5);
  });

  it('回报 comparedAgainst，供 UI 提示覆盖率', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    baseRows = [
      { executionId: 'e1', decision: 'approved', outcome: null, value: null },
      { executionId: 'e2', decision: 'approved', outcome: null, value: null },
    ];
    targetRows = [{ executionId: 'e1', decision: 'denied' }];
    const res = await GET(req('baseVersion=1&targetVersion=2'), { params });
    const body = await res.json();
    expect(body.comparedAgainst).toBe(1);
    expect(body.sampleSize).toBe(2);
    // e1 对齐、e2 未对齐
    expect(body.alignedCount).toBe(1);
  });

  // ★Number(null) === 0 而非 NaN —— 缺参数曾静默变成"版本 0"返回 200。
  it('版本为 0 或负数 → 400', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(req('baseVersion=0&targetVersion=2'), { params });
    expect(res.status).toBe(400);
  });

  // ★没有可对齐的执行时**必须拒绝给数字**。
  //
  // 一次执行只在一个版本下跑过，故两版本的 executionId 天然不重叠。若不做这个
  // 检查，newDecisions 命中不了任何样本，估算会输出 changed=0 / delta=0——
  // 也就是自信地宣称「改这个版本毫无影响」。那比报错糟得多：它看起来是个结论。
  it('★两版本无可对齐执行 → comparable:false，不给任何数字', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    baseRows = Array.from({ length: 40 }, (_, i) => ({
      executionId: `e-base-${i}`,
      decision: 'approved',
      outcome: 'converted',
      value: '100.0000',
    }));
    // 目标版本是**另一批** executionId —— 与真实生产数据形态一致
    targetRows = Array.from({ length: 40 }, (_, i) => ({
      executionId: `e-tgt-${i}`,
      decision: 'denied',
    }));

    const res = await GET(req('baseVersion=1&targetVersion=2&positiveOutcomes=converted'), {
      params,
    });
    const body = await res.json();

    expect(body.comparable).toBe(false);
    expect(body.reason).toBe('NO_ALIGNED_EXECUTIONS');
    // 关键：不得出现任何会被读成「无影响」的 0
    expect(body.changed).toBeUndefined();
    expect(body.estimatedValueDelta).toBeUndefined();
    expect(body.newlyRejected).toBeUndefined();
  });
});

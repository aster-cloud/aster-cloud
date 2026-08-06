// What-if 端点测试（Phase 4 已撤下，一律 409）。
//
// ★为什么撤下：十二轮交叉审查后判定「按需重跑」这条路线本身在持续制造缺陷
// （四轮 52→43→58→48 未收敛）。决定性的一条是**成功子集带选择偏差**——
// 重跑失败往往与输入/词汇/策略路径相关，剩下的成功样本不是随机子集，
// 据此出的业务数字可能方向正确而幅度全错。详见 route 头注释与 ADR 0033。
//
// 本文件只验三件事：鉴权、租户隔离（拒答不能变成存在性探针）、409 契约。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

const captured = vi.hoisted(() => [] as { where: unknown }[]);
const rowSets = vi.hoisted(() => ({ owned: [] as unknown[] }));

vi.mock('@/lib/prisma', () => {
  const makeChain = () => {
    const ctx: { where: unknown } = { where: undefined };
    captured.push(ctx);
    const chain = {
      where(w: unknown) {
        ctx.where = w;
        return chain;
      },
      limit: () => Promise.resolve(rowSets.owned),
    };
    return chain;
  };
  return {
    db: { select: () => ({ from: () => makeChain() }) },
    policies: new Proxy({}, { get: (_t, p) => `policies.${String(p)}` }),
  };
});

vi.mock('drizzle-orm', () => ({
  and: (...xs: unknown[]) => ({ op: 'and', xs }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}));

const { GET } = await import('@/app/api/policies/[id]/whatif/route');

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

describe('GET /api/policies/:id/whatif（已撤下，一律 409）', () => {
  beforeEach(() => {
    captured.length = 0;
    rowSets.owned = [{ id: 'p1' }];
    getSession.mockReset();
    getSession.mockResolvedValue({ user: { id: 'u1' } });
  });

  it('未登录 → 401', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET(req(), { params })).status).toBe(401);
  });

  it('★不是自己的策略 → 404 而不是 409', async () => {
    // 若先返回 409 再校验归属，本端点会退化成「策略是否存在」的探针
    rowSets.owned = [];
    expect((await GET(req(), { params })).status).toBe(404);
  });

  it('★归属校验必须带 userId', async () => {
    await GET(req(), { params });
    expect(eqPairs(captured[0]?.where).some((p) => p.endsWith('=u1'))).toBe(true);
  });

  it('★自己的策略 → 409 REPLAY_REQUIRED', async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('REPLAY_REQUIRED');
  });

  it('★响应不得包含任何会被读成结论的数字字段', async () => {
    const body = await (await GET(req(), { params })).json();
    for (const k of [
      'changed',
      'newlyApproved',
      'newlyRejected',
      'estimatedValueDelta',
      'baselinePositiveRate',
      'confidence',
      'comparable',
      'replaySuccessRate',
    ]) {
      expect(body[k]).toBeUndefined();
    }
  });
});

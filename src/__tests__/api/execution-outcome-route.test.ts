// 业务结果回传端点测试（Phase 3）。
//
// 这是个**写**端点且数据来自客户，故重点在两处：
//   1. 租户隔离——不能往别人的执行上写结果（会污染他人业务统计）
//   2. 输入校验——NaN/Infinity 进 numeric 列会让后续聚合全线崩坏

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

const captured: { where?: unknown; values?: unknown; conflict?: unknown }[] = [];
let execRows: unknown[] = [];

vi.mock('@/lib/prisma', () => ({
  db: {
    select: () => ({
      from: () => {
        const ctx: { where?: unknown } = {};
        captured.push(ctx);
        const chain = {
          where(w: unknown) {
            ctx.where = w;
            return chain;
          },
          limit: () => Promise.resolve(execRows),
        };
        return chain;
      },
    }),
    insert: () => ({
      values(v: unknown) {
        const ctx: { values: unknown; conflict?: unknown } = { values: v };
        captured.push(ctx);
        return {
          onConflictDoUpdate(c: unknown) {
            ctx.conflict = c;
            return Promise.resolve();
          },
        };
      },
    }),
  },
  executions: { id: 'executions.id', userId: 'executions.userId', policyId: 'executions.policyId' },
  executionOutcomes: { executionId: 'executionOutcomes.executionId' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...xs: unknown[]) => ({ op: 'and', xs }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}));

const { POST } = await import('@/app/api/v1/executions/[id]/outcome/route');

const params = Promise.resolve({ id: 'e1' });
const req = (body: unknown) =>
  new NextRequest('https://x.test/api/v1/executions/e1/outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

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

beforeEach(() => {
  captured.length = 0;
  execRows = [{ id: 'e1', policyId: 'p1' }];
  getSession.mockResolvedValue({ user: { id: 'u1' } });
  vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1' });
});

describe('POST /api/v1/executions/:id/outcome', () => {
  it('未登录 → 401', async () => {
    getSession.mockResolvedValue(null);
    expect((await POST(req({ outcome: 'converted' }), { params })).status).toBe(401);
  });

  it('★执行不属于当前用户 → 404（不泄露存在性、不允许跨租户写）', async () => {
    execRows = [];
    expect((await POST(req({ outcome: 'converted' }), { params })).status).toBe(404);
  });

  it('★归属查询带 userId 过滤（防跨租户写）', async () => {
    await POST(req({ outcome: 'converted' }), { params });
    const conds = flatten(captured[0].where);
    expect(conds).toContainEqual({ col: 'executions.id', val: 'e1' });
    expect(conds).toContainEqual({ col: 'executions.userId', val: 'u1' });
  });

  it('正常回传 → 写入并回 ok', async () => {
    const res = await POST(req({ outcome: 'converted', value: 1234.5 }), { params });
    expect(res.status).toBe(200);
    const ins = captured.find((c) => c.values)!.values as Record<string, unknown>;
    expect(ins.outcome).toBe('converted');
    expect(ins.value).toBe('1234.5');
    expect(ins.userId).toBe('u1');
    expect(ins.policyId).toBe('p1');
  });

  it('★幂等：同一执行重复回传走 upsert 覆盖，不堆叠', async () => {
    await POST(req({ outcome: 'converted' }), { params });
    const c = captured.find((x) => x.conflict)!;
    expect(c.conflict).toBeTruthy();
  });

  it('outcome 为空 → 400', async () => {
    expect((await POST(req({ outcome: '  ' }), { params })).status).toBe(400);
    expect((await POST(req({}), { params })).status).toBe(400);
  });

  it('outcome 超长 → 400', async () => {
    expect((await POST(req({ outcome: 'x'.repeat(65) }), { params })).status).toBe(400);
  });

  // ★NaN/Infinity 落进 numeric 列会让后续聚合全线崩坏，且 JSON 里 Infinity
  //   会被序列化成 null 造成静默丢数——必须在入口挡住
  it('★value 为 NaN / Infinity → 400（不静默收下）', async () => {
    expect((await POST(req({ outcome: 'c', value: 'not-a-number' }), { params })).status).toBe(400);
    expect((await POST(req({ outcome: 'c', value: 'Infinity' }), { params })).status).toBe(400);
  });

  it('value 可省略（不是所有结局都有金额）', async () => {
    const res = await POST(req({ outcome: 'rejected' }), { params });
    expect(res.status).toBe(200);
    const ins = captured.find((c) => c.values)!.values as Record<string, unknown>;
    expect(ins.value).toBeNull();
  });

  it('occurredAt 非法 → 400；合法 → 转成 Date', async () => {
    expect((await POST(req({ outcome: 'c', occurredAt: 'xx' }), { params })).status).toBe(400);
    captured.length = 0;
    await POST(req({ outcome: 'c', occurredAt: '2026-08-01T00:00:00Z' }), { params });
    const ins = captured.find((c) => c.values)!.values as Record<string, unknown>;
    expect(ins.occurredAt).toBeInstanceOf(Date);
  });

  it('note 被截断到上限', async () => {
    await POST(req({ outcome: 'c', note: 'n'.repeat(2000) }), { params });
    const ins = captured.find((c) => c.values)!.values as Record<string, unknown>;
    expect((ins.note as string).length).toBe(1024);
  });

  it('非法 JSON / 数组体 → 400', async () => {
    expect((await POST(req('not json'), { params })).status).toBe(400);
    expect((await POST(req([1, 2]), { params })).status).toBe(400);
  });
});

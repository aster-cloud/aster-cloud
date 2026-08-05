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
// upsert 的 returning 结果：空数组 = 守卫拦下未写入
let upsertReturns: unknown[] = [{ executionId: 'e1' }];

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
            // returning() 决定 route 回报 applied 与否；默认视为写入成功
            return {
              returning: () => Promise.resolve(upsertReturns),
            };
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
  // 模板字面量标签：保留片段与插值，便于断言"守卫条件是否真的加上了"
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    text: strings.join('?'),
    values,
  }),
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

  // ★P1 回归：upsert 必须带「业务时间更新才覆盖」的守卫。
  //
  // 原实现是无条件 last-write-wins：「A 超时 → B 更正 → A 延迟重试」时，
  // 迟到的旧 A 会静默回滚掉 B 的更正。已用真 PostgreSQL 验证守卫生效
  // （旧重试为 no-op），此处锁住守卫不被无意移除。
  it('★带 occurredAt 时 upsert 必须限定业务时间更新才覆盖', async () => {
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    execRows = [{ id: 'e1', policyId: 'p1' }];
    captured.length = 0;

    await POST(req({ outcome: 'converted', occurredAt: '2026-01-03T00:00:00Z' }), { params });

    const c = captured.at(-1)?.conflict as { where?: { op: string; text: string } };
    expect(c?.where).toBeDefined();
    expect(c!.where!.op).toBe('sql');
    // 守卫语义：旧值为空 或 旧值早于新值
    expect(c!.where!.text).toContain('IS NULL');
    // <= 而非 <：同业务时间的更正是合法需求，不能静默拒掉
    expect(c!.where!.text).toContain('<=');
  });

  it('未提供 occurredAt 时只允许覆盖同样无时间的那条', async () => {
    // 不能让一条无业务时间的迟到重试抹掉带时间的更正
    getSession.mockResolvedValue({ user: { id: 'u1' } });
    execRows = [{ id: 'e1', policyId: 'p1' }];
    captured.length = 0;

    await POST(req({ outcome: 'converted' }), { params });

    const c = captured.at(-1)?.conflict as { where?: { op: string; text: string } };
    expect(c?.where).toBeDefined();
    expect(c!.where!.text).toContain('IS NULL');
    expect(c!.where!.text).not.toContain('<');
  });

  // ★P1-4 回归：value 必须按 numeric(20,4) 契约在字符串域严格校验。
  //
  // 原实现走 Number()，把明显不是金额的输入静默变成数字：
  //   "" → 0、"   " → 0、false → 0、[] → 0、true → 1
  // 金额记成 0 元比报错糟得多——它会污染 Phase 4 均值且事后查不出来。
  // 另外 1e20 能过 Number.isFinite 但超出列范围，落库时 PG 报 overflow → 500。
  describe('★value 严格十进制校验', () => {
    const post = async (v: unknown) => {
      getSession.mockResolvedValue({ user: { id: 'u1' } });
      execRows = [{ id: 'e1', policyId: 'p1' }];
      captured.length = 0;
      const res = await POST(req({ outcome: 'converted', value: v }), { params });
      return { status: res.status, values: captured.at(-1)?.values as { value?: string } };
    };

    it.each([
      ['空字符串', ''],
      ['纯空白', '   '],
      ['布尔 false', false],
      ['布尔 true', true],
      ['空数组', []],
      ['对象', { a: 1 }],
      ['非数值字符串', 'abc'],
      ['指数记法', '1e20'],
    ])('%s → 400（不得静默转成数字）', async (_label, v) => {
      const { status } = await post(v);
      expect(status).toBe(400);
    });

    it('超出 numeric(20,4) 范围 → 400（而不是落库时 500）', async () => {
      expect((await post(1e20)).status).toBe(400);
      expect((await post('12345678901234567')).status).toBe(400); // 17 位整数
      expect((await post('1.23456')).status).toBe(400); // 5 位小数
    });

    it('高精度十进制字符串不得被 JS number 截断', async () => {
      // Number("1234567890123456.1234") 会丢掉小数部分
      const { status, values } = await post('1234567890123456.1234');
      expect(status).toBe(200);
      expect(values?.value).toBe('1234567890123456.1234');
    });

    it('合法值正常通过并规范化', async () => {
      expect((await post(100)).values?.value).toBe('100');
      expect((await post('0012.50')).values?.value).toBe('12.50');
      expect((await post(-3.5)).values?.value).toBe('-3.5');
      expect((await post('-0.0000')).values?.value).toBe('0.0000');
    });
  });

  // ★第三轮审查：守卫拦下时不能一律 ok:true —— 调用方必须能区分
  // 「已记录」和「被判定过期、静默丢弃」，否则它会以为自己的更正生效了。
  describe('★applied 如实回报写入结果', () => {
    it('正常写入 → applied: true', async () => {
      getSession.mockResolvedValue({ user: { id: 'u1' } });
      execRows = [{ id: 'e1', policyId: 'p1' }];
      upsertReturns = [{ executionId: 'e1' }];

      const res = await POST(req({ outcome: 'converted' }), { params });
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(body.reason).toBeUndefined();
    });

    it('被守卫拦下 → applied: false 且给出原因', async () => {
      getSession.mockResolvedValue({ user: { id: 'u1' } });
      execRows = [{ id: 'e1', policyId: 'p1' }];
      upsertReturns = []; // 守卫拦下，0 行受影响

      const res = await POST(
        req({ outcome: 'stale', occurredAt: '2026-01-01T00:00:00Z' }),
        { params },
      );
      const body = await res.json();
      expect(body.applied).toBe(false);
      expect(body.reason).toBe('STALE_OCCURRED_AT');
    });
  });

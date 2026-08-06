// 业务结果回传端点测试（Phase 3）。
//
// 这是个**写**端点且数据来自客户，故重点在两处：
//   1. 租户隔离——不能往别人的执行上写结果（会污染他人业务统计）
//   2. 输入校验——NaN/Infinity 进 numeric 列会让后续聚合全线崩坏

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getSession = vi.fn();
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

/** API Key 鉴权：默认不被调用；带 Authorization 头时才走这条路。 */
const authenticateApiRequest = vi.fn();
vi.mock('@/lib/api-keys', () => ({
  authenticateApiRequest: (r: Request) => authenticateApiRequest(r),
}));

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
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('https://x.test/api/v1/executions/e1/outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
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
  // ★清空调用记录：鉴权用例要断言「某条路径没被走过」，
  //   累积的调用次数会让 not.toHaveBeenCalled() 恒假。
  getSession.mockReset();
  authenticateApiRequest.mockReset();
  getSession.mockResolvedValue({ user: { id: 'u1' } });
  upsertReturns = [{ executionId: 'e1' }];
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

  // ★Phase 3 鉴权契约（第四轮交叉审查点名：外部契约不匹配）。
  //
  // 本端点的主要调用方是**客户后台**——决策落地几天后才知道结局，那时早已
  // 不是一次浏览器会话。同层 /api/v1/policies/:id/execute 用 API Key，
  // 若本端点只认 cookie session，客户拿已有的 key 根本回传不了。
  describe('★鉴权：API Key 优先，Session 兜底', () => {
    it('带 Bearer 且 key 有效 → 用 key 的 userId 写入', async () => {
      authenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'key-user',
        apiKeyId: 'k1',
      });
      execRows = [{ id: 'e1', policyId: 'p1' }];
      captured.length = 0;

      const res = await POST(
        req({ outcome: 'converted' }, { authorization: 'Bearer sk_live_x' }),
        { params },
      );

      expect(res.status).toBe(200);
      expect((captured.at(-1)?.values as { userId?: string })?.userId).toBe('key-user');
      // 走了 key 就不该再去读 session
      expect(getSession).not.toHaveBeenCalled();
    });

    it('★带 Bearer 但 key 无效 → 401，不得悄悄回落到 session', async () => {
      // 否则一个拿着过期 key 的后台任务，会因为恰好带了某人的 cookie 而写成功，
      // 且写到**那个人**名下 —— 静默的跨身份写入。
      authenticateApiRequest.mockResolvedValue({
        success: false,
        error: 'Invalid API key',
        status: 401,
      });
      getSession.mockResolvedValue({ user: { id: 'u1' } });
      execRows = [{ id: 'e1', policyId: 'p1' }];

      const res = await POST(
        req({ outcome: 'converted' }, { authorization: 'Bearer expired' }),
        { params },
      );

      expect(res.status).toBe(401);
      expect(getSession).not.toHaveBeenCalled();
    });

    it('无 Authorization 头 → 回落 session（控制台人工补录）', async () => {
      getSession.mockResolvedValue({ user: { id: 'u1' } });
      execRows = [{ id: 'e1', policyId: 'p1' }];
      captured.length = 0;

      const res = await POST(req({ outcome: 'converted' }), { params });

      expect(res.status).toBe(200);
      expect((captured.at(-1)?.values as { userId?: string })?.userId).toBe('u1');
      expect(authenticateApiRequest).not.toHaveBeenCalled();
    });

    it('两种凭据都没有 → 401', async () => {
      getSession.mockResolvedValue(null);
      const res = await POST(req({ outcome: 'converted' }), { params });
      expect(res.status).toBe(401);
    });

    it('★API Key 身份同样受租户隔离约束', async () => {
      // key 的 userId 与 execution 的 owner 不符时必须 404
      authenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'key-user',
        apiKeyId: 'k1',
      });
      execRows = []; // 按 (id, callerUserId) 查不到

      const res = await POST(
        req({ outcome: 'converted' }, { authorization: 'Bearer sk_live_x' }),
        { params },
      );
      expect(res.status).toBe(404);
    });
  });

  // ★第五轮审查：occurredAt 文档写的是 ISO 字符串，实现却接受数字。
  // new Date(String(0)) === 2000-01-01（"0" 被当成年份），能过校验并直接
  // 参与 last-write-wins 胜负判定 —— 一个被误读成 2000 年的时间戳会让
  // 这条回传永远打不过已存记录，或反过来把正确记录挤掉。
  describe('★occurredAt 必须是 ISO 8601 字符串', () => {
    const post = async (v: unknown) => {
      getSession.mockResolvedValue({ user: { id: 'u1' } });
      execRows = [{ id: 'e1', policyId: 'p1' }];
      const res = await POST(req({ outcome: 'converted', occurredAt: v }), { params });
      return res.status;
    };

    it.each([
      ['数字 0（会被读成 2000 年）', 0],
      ['数字 1（会被读成 2001 年）', 1],
      ['数字时间戳', 1780000000000],
      ['布尔', true],
      ['数组', []],
      ['裸年份字符串', '2026'],
      ['非日期字符串', 'yesterday'],
    ])('%s → 400', async (_label, v) => {
      expect(await post(v)).toBe(400);
    });

    // ★第六轮：形状对 + Date 能解析仍不够 —— JS 把不存在的日期静默归一
    //   （2026-02-30 → 2026-03-02），这个被改写的时间会直接参与
    //   last-write-wins 胜负判定。
    it.each([
      ['2 月 30 日', '2026-02-30'],
      ['13 月', '2026-13-01'],
      ['非闰年 2 月 29', '2025-02-29'],
      ['0 月', '2026-00-10'],
    ])('不存在的日历日 %s → 400', async (_l, v) => {
      expect(await post(v)).toBe(400);
    });

    it('合法 ISO 字符串正常接受', async () => {
      expect(await post('2026-03-14T08:00:00Z')).toBe(200);
      expect(await post('2026-03-14')).toBe(200);
      // 闰年 2/29 是合法日历日
      expect(await post('2024-02-29')).toBe(200);
      // ★带时区偏移可能落到另一个 UTC 日，不得被误判为非法
      expect(await post('2026-03-14T23:00:00+14:00')).toBe(200);
    });
  });

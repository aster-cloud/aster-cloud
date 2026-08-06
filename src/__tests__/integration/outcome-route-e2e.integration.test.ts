// Outcome 端点 **route→真实 PostgreSQL** 端到端测试。
//
// ★为什么单独一个文件：第五轮交叉审查指出，
// `strategy-replay-analytics.integration.test.ts` 那 15 条虽然连的是真库，但它
// **复制了 route 的 upsert SQL**，而不是调用 route —— 把生产 route 改坏，
// 那 15 条仍然全绿。它证明了 SQL 语义，没证明接线。
//
// 本文件调用**生产 route 的 POST 函数**，只 stub 掉 auth（session/API key
// 依赖 next-auth 运行时与 key 表，与本测试要验的东西无关），
// 数据库、SQL、约束、类型转换全部走真的。
//
// 判据：把 route 的守卫/校验改坏，本文件必须报红。
//
// Run: pnpm test:integration:onprem

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// ★只 stub 鉴权，不碰 db —— @/lib/prisma 的 db 是 getDb() 的惰性 Proxy，
//   由 setupTestDb 设置的 DATABASE_URL 指向真实容器。
const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

const authenticateApiRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-keys', () => ({
  authenticateApiRequest: (r: Request) => authenticateApiRequest(r),
}));

const { db, executions, policies, executionOutcomes } = await import('@/lib/prisma');
const { setupTestDb, teardownTestDb, cleanupTestDb } = await import('./setup-postgres');
const { POST } = await import('@/app/api/v1/executions/[id]/outcome/route');

const U = 'user-e2e-1';
const POL = 'pol-e2e-1';
const EXEC = 'exec-e2e-1';

type PostBody = Record<string, unknown>;

/** 直接调用生产 route。NextRequest 由 next/server 提供，走真实解析路径。 */
async function callRoute(body: PostBody | string, headers: Record<string, string> = {}) {
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(`https://x.test/api/v1/executions/${EXEC}/outcome`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ id: EXEC }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function storedOutcome() {
  const rows = await db
    .select({
      outcome: executionOutcomes.outcome,
      value: executionOutcomes.value,
      occurredAt: executionOutcomes.occurredAt,
      userId: executionOutcomes.userId,
    })
    .from(executionOutcomes)
    .where(eq(executionOutcomes.executionId, EXEC))
    .limit(1);
  return rows[0] ?? null;
}

describe('POST /api/v1/executions/:id/outcome —— route → 真实 PostgreSQL', () => {
  beforeAll(async () => {
    await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
    getSession.mockReset();
    authenticateApiRequest.mockReset();
    getSession.mockResolvedValue({ user: { id: U } });

    await db.insert(policies).values({
      id: POL,
      userId: U,
      name: 'e2e',
      content: 'Module M. Rule R.',
      updatedAt: new Date(),
    } as typeof policies.$inferInsert);
    await db.insert(executions).values({
      id: EXEC,
      userId: U,
      policyId: POL,
      input: {},
      output: {},
      durationMs: 1,
      success: true,
      createdAt: new Date(),
    } as typeof executions.$inferInsert);
  });

  it('★首次回传：route 真的把行写进了 PostgreSQL', async () => {
    const { status, json } = await callRoute({
      outcome: 'converted',
      value: '12500.5000',
      occurredAt: '2026-03-14T08:00:00Z',
    });

    expect(status).toBe(200);
    expect(json.applied).toBe(true);

    const row = await storedOutcome();
    expect(row?.outcome).toBe('converted');
    expect(row?.value).toBe('12500.5000');
    expect(row?.userId).toBe(U);
  });

  it('★迟到的旧重试：route 返回 applied:false 且库里保持不变', async () => {
    await callRoute({ outcome: 'converted', occurredAt: '2026-03-14T08:00:00Z' });

    const { status, json } = await callRoute({
      outcome: 'defaulted',
      occurredAt: '2026-03-01T08:00:00Z',
    });

    expect(status).toBe(200);
    // 这是 route 的 applied 逻辑 + PG 的 RETURNING 语义联合决定的，
    // 复制 SQL 的测试证明不了「route 如实回报」这一半。
    expect(json.applied).toBe(false);
    expect(json.reason).toBe('STALE_OCCURRED_AT');
    expect((await storedOutcome())?.outcome).toBe('converted');
  });

  it('同业务时间的更正生效（<= 而非 <）', async () => {
    await callRoute({ outcome: 'typo', occurredAt: '2026-03-14T08:00:00Z' });
    const { json } = await callRoute({ outcome: 'corrected', occurredAt: '2026-03-14T08:00:00Z' });

    expect(json.applied).toBe(true);
    expect((await storedOutcome())?.outcome).toBe('corrected');
  });

  it('★numeric(20,4) 高精度值经 route 原样落库（JS Number 会截断这个值）', async () => {
    const { status } = await callRoute({
      outcome: 'converted',
      value: '1234567890123456.1234',
    });
    expect(status).toBe(200);
    expect((await storedOutcome())?.value).toBe('1234567890123456.1234');
  });

  it('★越界金额被 route 挡成 400，而不是落库时 500', async () => {
    const { status, json } = await callRoute({
      outcome: 'converted',
      value: '100000000000000000000',
    });
    expect(status).toBe(400);
    expect((json.error as { code?: string })?.code).toBe('INVALID_VALUE');
    expect(await storedOutcome()).toBeNull();
  });

  it('★occurredAt 传数字 0 被拒（否则会被读成 2000 年并参与时序判定）', async () => {
    const { status } = await callRoute({ outcome: 'converted', occurredAt: 0 });
    expect(status).toBe(400);
    expect(await storedOutcome()).toBeNull();
  });

  it('★跨租户：别人的 execution 一律 404，且不产生任何写入', async () => {
    getSession.mockResolvedValue({ user: { id: 'someone-else' } });

    const { status } = await callRoute({ outcome: 'converted' });

    expect(status).toBe(404);
    expect(await storedOutcome()).toBeNull();
  });

  it('★API Key 通道同样能写入真库', async () => {
    authenticateApiRequest.mockResolvedValue({ success: true, userId: U, apiKeyId: 'k1' });

    const { status, json } = await callRoute(
      { outcome: 'converted' },
      { authorization: 'Bearer sk_live_x' },
    );

    expect(status).toBe(200);
    expect(json.applied).toBe(true);
    expect((await storedOutcome())?.userId).toBe(U);
    expect(getSession).not.toHaveBeenCalled();
  });

  it('★key 无效不得回落 session：401 且零写入', async () => {
    authenticateApiRequest.mockResolvedValue({
      success: false,
      error: 'Invalid API key',
      status: 401,
    });
    getSession.mockResolvedValue({ user: { id: U } });

    const { status } = await callRoute(
      { outcome: 'converted' },
      { authorization: 'Bearer expired' },
    );

    expect(status).toBe(401);
    expect(await storedOutcome()).toBeNull();
  });

  it('并发重复投递经 route 只落 1 行（unique 约束 + upsert 在竞态下成立）', async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        callRoute({ outcome: 'converted', occurredAt: '2026-03-14T08:00:00Z' }),
      ),
    );
    const rows = await db
      .select({ id: executionOutcomes.id })
      .from(executionOutcomes)
      .where(eq(executionOutcomes.executionId, EXEC));
    expect(rows).toHaveLength(1);
  });
});

// What-if 端点 **route→真实 PostgreSQL** 端到端测试（Phase 4，ADR 0033）。
//
// ★与单测的分工：单测用 mock db 验控制流；本文件调用**生产 route 的 GET**，
// 让它真的去查 User 开关、PolicyVersion 源码、Execution+ExecutionOutcome 左连接。
// 只 stub aster-api 的 HTTP 客户端（`evaluateSource`）——跨进程调真引擎属于
// 另一层集成，不是本文件的职责；除它之外 DB/SQL/JOIN/类型全走真的。
//
// 判据：把 route 的授权/门槛/失败计数改坏，本文件必须报红。
//
// Run: pnpm test:integration:onprem

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));

const evaluateSource = vi.hoisted(() => vi.fn());
vi.mock('@/services/policy/policy-api', () => ({
  createPolicyApiClient: () => ({ evaluateSource }),
}));

const { db, policies, policyVersions, executions, executionOutcomes, users } =
  await import('@/lib/prisma');
const { setupTestDb, teardownTestDb, cleanupTestDb } = await import('./setup-postgres');
const { GET } = await import('@/app/api/policies/[id]/whatif/route');

const U = 'user-wi-1';
const POL = 'pol-wi-1';

// ★平台不再猜 outcome 词汇，故 E2E 默认带 taxonomy（第十轮 P0-4）
const TAX = 'positiveOutcomes=converted&negativeOutcomes=defaulted';
async function callRoute(qs = `baseVersion=1&targetVersion=2&${TAX}`) {
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(`https://x.test/api/policies/${POL}/whatif?${qs}`);
  const res = await GET(req, { params: Promise.resolve({ id: POL }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** 播 n 条基线执行；replayable=false 时标 NON_REPLAYABLE。 */
async function seedExecutions(n: number, opts: { replayable?: boolean; offset?: number } = {}) {
  const { replayable = true, offset = 0 } = opts;
  for (let i = 0; i < n; i++) {
    const id = `e-${offset + i}`;
    await db.insert(executions).values({
      id,
      userId: U,
      policyId: POL,
      input: { score: 600 + i },
      output: {},
      durationMs: 1,
      success: true,
      decision: 'approved',
      policyVersion: 1,
      locale: 'en',
      functionName: 'assess',
      replayabilityStatus: replayable ? 'REPLAYABLE' : 'NON_REPLAYABLE',
      createdAt: new Date(),
    } as typeof executions.$inferInsert);
    await db.insert(executionOutcomes).values({
      id: `o-${offset + i}`,
      executionId: id,
      userId: U,
      policyId: POL,
      outcome: 'converted',
      value: '100.0000',
      occurredAt: new Date(),
    } as typeof executionOutcomes.$inferInsert);
  }
}

describe('GET /api/policies/:id/whatif —— route → 真实 PostgreSQL', () => {
  beforeAll(async () => {
    await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
    getSession.mockReset();
    evaluateSource.mockReset();
    getSession.mockResolvedValue({ user: { id: U } });
    // 默认重跑成功且翻成拒绝
    evaluateSource.mockResolvedValue({ result: 'REJECTED', error: null, executionTimeMs: 1 });

    await db.insert(users).values({
      id: U,
      email: 'wi@test.local',
      name: 'WI',
      replayRetentionEnabled: true, // 默认已授权；未授权用例单独改
      updatedAt: new Date(),
    } as typeof users.$inferInsert);
    await db.insert(policies).values({
      id: POL,
      userId: U,
      name: 'wi',
      content: 'Module M. Rule assess...',
      version: 2,
      updatedAt: new Date(),
    } as typeof policies.$inferInsert);
    await db.insert(policyVersions).values({
      id: 'pv-2',
      policyId: POL,
      version: 2,
      content: 'Module M. Rule assess given score as Number produce Text: Return "REJECTED".',
      source: 'Module M. Rule assess given score as Number produce Text: Return "REJECTED".',
      createdBy: U,
    } as typeof policyVersions.$inferInsert);
  });

  describe('★显式授权开关（真库读 User 行）', () => {
    it('未开 replayRetentionEnabled → 403 且零重跑', async () => {
      await db.update(users).set({ replayRetentionEnabled: false });
      await seedExecutions(40);

      const { status, json } = await callRoute();

      expect(status).toBe(403);
      expect((json.error as { code?: string })?.code).toBe('REPLAY_RETENTION_DISABLED');
      // ★不能静默降级成空结果，也不能白跑一遍重放
      expect(evaluateSource).not.toHaveBeenCalled();
    });

    it('已授权 → 正常给出估算', async () => {
      await seedExecutions(40);
      const { status, json } = await callRoute();

      expect(status).toBe(200);
      expect(json.comparable).toBe(true);
      expect(json.replayed).toBe(40);
      // 40 条 approved 全被目标版本判成 denied
      expect(json.newlyRejected).toBe(40);
    });
  });

  describe('★双判门槛（真库计数）', () => {
    it('可重跑条数不足 → INSUFFICIENT_REPLAYED，一个数字都不给', async () => {
      await seedExecutions(10);
      const { json } = await callRoute();

      expect(json.comparable).toBe(false);
      expect(json.reason).toBe('INSUFFICIENT_REPLAYED');
      expect(json.changed).toBeUndefined();
      expect(json.estimatedValueDelta).toBeUndefined();
    });

    it('★可重跑总数远超已跑数 → INSUFFICIENT_COVERAGE', async () => {
      // ★第八轮 P0-9 后覆盖率口径已修正为 replayed / **全量可重跑数**
      //   （原先用全量执行数做分母，replayed 上限 200 会让大策略永远达不到门槛）。
      //   这里造 250 条可重跑但只让 35 条成功：35/250 = 14% < 20%。
      await seedExecutions(250, { replayable: true });
      let n = 0;
      evaluateSource.mockImplementation(async () => {
        n += 1;
        return n <= 35
          ? { result: 'REJECTED', error: null, executionTimeMs: 1 }
          : { result: null, error: 'boom', executionTimeMs: 1 };
      });

      const { json } = await callRoute();

      expect(json.comparable).toBe(false);
      expect(json.reason).toBe('LOW_REPLAY_SUCCESS_RATE');
      expect(json.replayed).toBe(35);
      expect(json.replayable).toBe(250); // 全量可重跑数，非 LIMIT 后
      expect(json.changed).toBeUndefined();
    });
  });

  describe('★重跑失败不得当成「决策未变」', () => {
    it('error 非空计入 replayFailed（真库路径）', async () => {
      evaluateSource.mockResolvedValue({ result: null, error: 'compile failed', executionTimeMs: 1 });
      await seedExecutions(40);

      const { json } = await callRoute();

      expect(json.replayFailed).toBe(40);
      expect(json.replayed).toBe(0);
      expect(json.comparable).toBe(false);
    });
  });

  it('只重跑 REPLAYABLE 的执行（真库过滤）', async () => {
    await seedExecutions(30, { replayable: true });
    await seedExecutions(5, { replayable: false, offset: 500 });

    await callRoute();

    expect(evaluateSource).toHaveBeenCalledTimes(30);
  });

  it('★跨租户：别人的策略 404，且不读 User 开关也不重跑', async () => {
    getSession.mockResolvedValue({ user: { id: 'someone-else' } });
    await seedExecutions(40);

    const { status } = await callRoute();

    expect(status).toBe(404);
    expect(evaluateSource).not.toHaveBeenCalled();
  });

  it('目标版本不存在 → 404（真库查不到 PolicyVersion）', async () => {
    await seedExecutions(40);
    const { status, json } = await callRoute(`baseVersion=1&targetVersion=99&${TAX}`);

    expect(status).toBe(404);
    expect((json.error as { code?: string })?.code).toBe('VERSION_NOT_FOUND');
  });

  it('★重跑用的是目标版本源码（不是基线版本）', async () => {
    await seedExecutions(40);
    await callRoute();

    // 第一个参数应是 PolicyVersion(v2).source
    const firstCallSource = evaluateSource.mock.calls[0]?.[0];
    expect(String(firstCallSource)).toContain('REJECTED');
  });

  it('★重跑必须带 simulate=true（真库路径，第八轮 P0-1）', async () => {
    await seedExecutions(40);
    await callRoute();

    // 不带它，200 条重跑会被当成 200 次真实执行：扣配额 + 污染 KPI + 写审计
    const opts = evaluateSource.mock.calls[0]?.[2] as { simulate?: boolean };
    expect(opts?.simulate).toBe(true);
  });

});

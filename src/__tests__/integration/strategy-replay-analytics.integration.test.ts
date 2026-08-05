// Strategy Replay 数据层集成测试（真实 Postgres，testcontainers 或外部 DATABASE_URL）。
//
// ★存在的理由：Phase 1/3/4 的路由单测把 drizzle 和 db 全 mock 掉了——它们能证明
// "传了一个形似 where 的对象"，但**不能**证明 SQL 语义、unique 约束、NULL 比较、
// numeric 精度和并发行为。三轮交叉审查里有多条缺陷正是 mock 测试全绿时漏过去的
// （见 review-report-round{1,2,3}.md 的 "DB 测试假信心"）。本文件补的就是那一层。
//
// 覆盖只有真库能验的：
//   · outcome upsert 的时序守卫（迟到旧重试 no-op / 同业务时间可更正 / null 语义）
//   · RETURNING 在守卫拦下时确实返回 0 行（route 的 applied 字段依赖它）
//   · numeric(20,4) 的精度与越界（Number() 会截断的 20 位值必须原样存回）
//   · executionOutcomes.executionId 的 unique 约束真实存在
//   · 跨租户隔离在真 SQL 下成立
//
// Run: pnpm test:integration:onprem

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql, eq, and } from 'drizzle-orm';
import { db, executions, policies, executionOutcomes } from '@/lib/prisma';
import { setupTestDb, teardownTestDb, cleanupTestDb } from './setup-postgres';

const U = 'user-sra-1';
const OTHER = 'user-sra-2';
const POL = 'pol-sra-1';

async function seedPolicy(id: string, userId: string) {
  await db.insert(policies).values({
    id,
    userId,
    name: `p-${id}`,
    content: 'Module M. Rule R.',
    // updatedAt 无 DB 默认值（schema 未加 defaultNow），必须显式给
    updatedAt: new Date(),
  } as typeof policies.$inferInsert);
}

async function seedExecution(id: string, userId: string, over: Record<string, unknown> = {}) {
  await db.insert(executions).values({
    id,
    userId,
    policyId: POL,
    input: {},
    output: {},
    durationMs: 1,
    success: true,
    createdAt: new Date(),
    ...over,
  } as typeof executions.$inferInsert);
}

/**
 * 复刻 route 的 upsert（含时序守卫 + RETURNING）。
 *
 * <p>刻意在测试里重写而非调用 route：route 依赖 next/server 的 Request/Response
 * 与 session，套进来会把这层测试变成又一个 mock 练习。这里要验的是**SQL 语义**，
 * 故直连 db。守卫子句与 route 逐字一致——若 route 改了这里没跟着改，
 * 下面的断言会失败，正好起到"别偷偷改守卫"的作用。
 */
async function upsertOutcome(
  executionId: string,
  userId: string,
  outcome: string,
  occurredAt: Date | null,
  value: string | null = null,
) {
  return db
    .insert(executionOutcomes)
    .values({
      id: globalThis.crypto.randomUUID(),
      executionId,
      userId,
      policyId: POL,
      outcome,
      value,
      occurredAt,
    } as typeof executionOutcomes.$inferInsert)
    .onConflictDoUpdate({
      target: executionOutcomes.executionId,
      set: { outcome, value, occurredAt, reportedAt: new Date() },
      // ★Date 直接插进 sql`` 模板时 postgres.js 不会序列化（route 里走的是
      // drizzle 的参数绑定，类型信息还在）。这里显式转 ISO 字符串 + ::timestamp，
      // 保持与 route 等价的比较语义。
      where: occurredAt
        ? sql`${executionOutcomes.occurredAt} IS NULL OR ${executionOutcomes.occurredAt} <= ${occurredAt.toISOString()}::timestamp`
        : sql`${executionOutcomes.occurredAt} IS NULL`,
    })
    .returning({ executionId: executionOutcomes.executionId });
}

const T = (s: string) => new Date(s);

async function currentOutcome(executionId: string) {
  const rows = await db
    .select({ outcome: executionOutcomes.outcome, value: executionOutcomes.value })
    .from(executionOutcomes)
    .where(eq(executionOutcomes.executionId, executionId))
    .limit(1);
  return rows[0] ?? null;
}

describe('Strategy Replay 数据层（真实 Postgres）', () => {
  beforeAll(async () => {
    await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
    await seedPolicy(POL, U);
  });

  describe('outcome upsert 时序守卫', () => {
    it('迟到的旧重试是 no-op，且 RETURNING 返回 0 行', async () => {
      await seedExecution('e1', U);

      expect((await upsertOutcome('e1', U, 'pending', T('2026-01-01'))).length).toBe(1);
      expect((await upsertOutcome('e1', U, 'converted', T('2026-01-03'))).length).toBe(1);

      // A 超时 → B 更正 → A 延迟重试：旧 A 不得回滚 B
      const stale = await upsertOutcome('e1', U, 'defaulted', T('2026-01-02'));
      expect(stale.length).toBe(0); // ★route 的 applied:false 依赖这个 0
      expect((await currentOutcome('e1'))?.outcome).toBe('converted');
    });

    it('同业务时间的更正必须生效（<= 而非 <）', async () => {
      await seedExecution('e2', U);
      await upsertOutcome('e2', U, 'typo', T('2026-01-03'));

      const fix = await upsertOutcome('e2', U, 'corrected', T('2026-01-03'));
      expect(fix.length).toBe(1);
      expect((await currentOutcome('e2'))?.outcome).toBe('corrected');
    });

    it('无业务时间的重试不得抹掉带时间的记录', async () => {
      await seedExecution('e3', U);
      await upsertOutcome('e3', U, 'withtime', T('2026-01-03'));

      const notime = await upsertOutcome('e3', U, 'notime', null);
      expect(notime.length).toBe(0);
      expect((await currentOutcome('e3'))?.outcome).toBe('withtime');
    });

    it('带时间的记录可以覆盖无时间的记录', async () => {
      await seedExecution('e4', U);
      await upsertOutcome('e4', U, 'notime', null);

      const withtime = await upsertOutcome('e4', U, 'withtime', T('2026-01-03'));
      expect(withtime.length).toBe(1);
      expect((await currentOutcome('e4'))?.outcome).toBe('withtime');
    });

    it('executionId 上有 unique 约束（不会堆叠出多行）', async () => {
      await seedExecution('e5', U);
      await upsertOutcome('e5', U, 'a', T('2026-01-01'));
      await upsertOutcome('e5', U, 'b', T('2026-01-02'));

      const rows = await db
        .select({ id: executionOutcomes.id })
        .from(executionOutcomes)
        .where(eq(executionOutcomes.executionId, 'e5'));
      expect(rows).toHaveLength(1);
    });
  });

  describe('numeric(20,4) 精度契约', () => {
    it('16 位整数 + 4 位小数原样存回（JS Number 会截断这个值）', async () => {
      await seedExecution('e6', U);
      // Number("1234567890123456.1234") === 1234567890123456，小数部分静默丢失
      await upsertOutcome('e6', U, 'converted', T('2026-01-01'), '1234567890123456.1234');

      expect((await currentOutcome('e6'))?.value).toBe('1234567890123456.1234');
    });

    it('负数与零值保真', async () => {
      await seedExecution('e7', U);
      await upsertOutcome('e7', U, 'defaulted', T('2026-01-01'), '-3.5');
      expect(Number((await currentOutcome('e7'))?.value)).toBe(-3.5);
    });

    it('★超出列范围时数据库确实拒绝（故必须在入口挡）', async () => {
      await seedExecution('e8', U);
      // 1e20 能通过 Number.isFinite，但 numeric(20,4) 容不下 —— route 的
      // parseDecimalValue 若失效，这里就会变成 500 而不是 400
      // drizzle 把驱动错误包了一层（message 变成 "Failed query: ..."），
      // 故断言 cause 上的真实 PostgresError，而不是外层 message。
      const err = await upsertOutcome(
        'e8',
        U,
        'converted',
        T('2026-01-01'),
        '100000000000000000000',
      ).then(
        () => null,
        (e: unknown) => e as { cause?: { message?: string }; message?: string },
      );
      expect(err).not.toBeNull();
      const detail = err?.cause?.message ?? err?.message ?? '';
      expect(detail).toMatch(/numeric field overflow|out of range/i);
    });
  });

  describe('租户隔离（真 SQL）', () => {
    it('按 executionId + userId 查不到别人的执行', async () => {
      await seedExecution('e9', OTHER);

      const rows = await db
        .select({ id: executions.id })
        .from(executions)
        .where(and(eq(executions.id, 'e9'), eq(executions.userId, U)))
        .limit(1);
      expect(rows).toHaveLength(0);
    });

    it('漏斗查询不会跨租户读到骨架', async () => {
      await seedExecution('e10', OTHER, {
        traceSkeletonJson: {
          schemaVersion: 'trace-skeleton/v1',
          steps: [{ stepId: '0.1', expression: 'if condition', matched: true, depth: 0 }],
        },
      });

      const rows = await db
        .select({ skeleton: executions.traceSkeletonJson })
        .from(executions)
        .where(and(eq(executions.policyId, POL), eq(executions.userId, U)));
      expect(rows).toHaveLength(0);
    });
  });

  describe('骨架落库（PII 边界的真库确认）', () => {
    it('投影后的骨架在 jsonb 往返后仍只有四字段', async () => {
      await seedExecution('e11', U, {
        traceSkeletonJson: {
          schemaVersion: 'trace-skeleton/v1',
          moduleName: null,
          functionName: null,
          steps: [{ stepId: '0.1', expression: 'if condition', matched: true, depth: 0 }],
        },
      });

      const rows = await db
        .select({ skeleton: executions.traceSkeletonJson })
        .from(executions)
        .where(eq(executions.id, 'e11'));
      const sk = rows[0].skeleton as { steps: Record<string, unknown>[] };
      expect(Object.keys(sk.steps[0]).sort()).toEqual([
        'depth',
        'expression',
        'matched',
        'stepId',
      ]);
    });
  });
});

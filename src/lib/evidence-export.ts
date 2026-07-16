// 证据导出查询层：投影 executions 的**哈希/溯源字段**（现有 queryExecutionLogs 故意不投影它们）。
//
// 与 policy-execution-log 分开：那里给日志 UI（input/output/error），这里给证据包（哈希/溯源，
// **默认排除 traceJson 等 PII 明文**，只导 traceHash）。

import { db, executions, policies } from '@/lib/prisma';
import { and, eq, gte, lte, asc, isNull, inArray, sql } from 'drizzle-orm';
import type { EvidenceRow } from '@/services/evidence/bundle';
import type { DecisionTally, EvidenceDecision, EvidencePreview } from '@/services/evidence/types';

/** 单次导出的执行行数上限（安全阀，防无界 data json / 大响应）。超出即拒，提示用户缩小范围。 */
export const EVIDENCE_EXPORT_ROW_LIMIT = 50_000;

export class EvidenceTooLargeError extends Error {
  constructor(public readonly count: number, public readonly limit: number) {
    super(`Evidence export too large: ${count} executions exceeds limit ${limit}`);
    this.name = 'EvidenceTooLargeError';
  }
}

export interface EvidenceQuery {
  userId: string;
  /** undefined = 该用户全部策略。 */
  policyId?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * 统一 WHERE（count/preview/query 三处共用，保证语义一致——Codex 审查：否则预览计数会高于实际
 * 导出、已删策略行还会误触发 413）。
 *
 * 用**非相关**子查询排除已删策略：policyId IN (SELECT id FROM Policy WHERE userId=? AND deletedAt
 * IS NULL)。刻意不用相关 EXISTS——drizzle 的 findMany 把主表 alias 成 "executions" 而 db.select 用
 * 原表名 "Execution"，相关子查询里 executions.policyId 会渲染成错误的表引用（真库实测 42P01）。
 * 非相关子查询自包含，与外层 alias 无关，count/preview/query 三处渲染都正确。
 */
function buildConditions(q: EvidenceQuery) {
  const livePolicyIds = db
    .select({ id: policies.id })
    .from(policies)
    .where(and(eq(policies.userId, q.userId), isNull(policies.deletedAt)));

  const conditions = [
    eq(executions.userId, q.userId),
    inArray(executions.policyId, livePolicyIds),
  ];
  if (q.policyId) conditions.push(eq(executions.policyId, q.policyId));
  if (q.startDate) conditions.push(gte(executions.createdAt, q.startDate));
  if (q.endDate) conditions.push(lte(executions.createdAt, q.endDate));
  return and(...conditions);
}

/**
 * 查询证据行（投影哈希/溯源，排除已删策略，按 createdAt·id 升序保证 bundleHash 确定性）。
 * 超过 EVIDENCE_EXPORT_ROW_LIMIT 抛 EvidenceTooLargeError（调用方转 413）。
 */
export async function queryEvidenceExecutions(q: EvidenceQuery): Promise<EvidenceRow[]> {
  const whereClause = buildConditions(q);

  // 先 count 守卫（避免真拉回超大结果集）。
  const count = await countEvidenceExecutions(q);
  if (count > EVIDENCE_EXPORT_ROW_LIMIT) {
    throw new EvidenceTooLargeError(count, EVIDENCE_EXPORT_ROW_LIMIT);
  }

  const rows = await db.query.executions.findMany({
    where: whereClause,
    orderBy: [asc(executions.createdAt), asc(executions.id)],
    columns: {
      id: true,
      policyId: true,
      policyVersion: true,
      policyVersionRowId: true,
      decision: true,
      canonicalInputHash: true,
      canonicalOutputHash: true,
      traceHash: true,
      canonicalizationVersion: true,
      sourceToolchainId: true,
      runtimeToolchainId: true,
      replayabilityStatus: true,
      replayabilityReasons: true,
      reasonCodes: true,
      source: true,
      durationMs: true,
      createdAt: true,
      // ⚠️ 故意不选 input/output/traceJson——证据包=哈希/溯源清单，非明文数据 dump（PII）。
    },
    // 已删策略的执行由 buildConditions 的 EXISTS 子查询在 SQL 层排除，无需应用层再过滤。
  });

  return rows
    .map((r) => ({
      id: r.id,
      policyId: r.policyId,
      policyVersion: r.policyVersion,
      policyVersionRowId: r.policyVersionRowId,
      decision: r.decision as EvidenceDecision | null,
      canonicalInputHash: r.canonicalInputHash,
      canonicalOutputHash: r.canonicalOutputHash,
      traceHash: r.traceHash,
      canonicalizationVersion: r.canonicalizationVersion,
      sourceToolchainId: r.sourceToolchainId,
      runtimeToolchainId: r.runtimeToolchainId,
      replayabilityStatus: r.replayabilityStatus,
      replayabilityReasons: r.replayabilityReasons,
      reasonCodes: r.reasonCodes,
      source: r.source,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    }));
}

/** 统计范围内执行数（含已删策略的行——仅作 count 上限守卫的粗估；精确排除在 query 层做）。 */
export async function countEvidenceExecutions(q: EvidenceQuery): Promise<number> {
  const r = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(executions)
    .where(buildConditions(q));
  return r[0]?.count ?? 0;
}

/**
 * 导出前预览：count + decision 分布（GROUP BY，不拉行体）。exceedsLimit 让 UI 提前拦。
 * decision=null（legacy）计入 unknown 桶。
 */
export async function getEvidencePreview(q: EvidenceQuery): Promise<EvidencePreview> {
  const rows = await db
    .select({
      decision: executions.decision,
      count: sql<number>`count(*)::int`,
    })
    .from(executions)
    .where(buildConditions(q))
    .groupBy(executions.decision);

  const tally: DecisionTally = {
    approved: 0,
    denied: 0,
    indeterminate: 0,
    error: 0,
    unknown: 0,
  };
  let count = 0;
  for (const r of rows) {
    const key: keyof DecisionTally = (r.decision as EvidenceDecision | null) ?? 'unknown';
    tally[key] += r.count;
    count += r.count;
  }

  return {
    count,
    decisionTally: tally,
    exceedsLimit: count > EVIDENCE_EXPORT_ROW_LIMIT,
    limit: EVIDENCE_EXPORT_ROW_LIMIT,
  };
}

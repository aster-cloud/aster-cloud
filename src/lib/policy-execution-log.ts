// src/lib/policy-execution-log.ts
// 策略执行日志服务：查询、分页、统计

import { db, executions } from '@/lib/prisma';
import { eq, and, gte, lte, desc, lt, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import type { PolicyReplayMetadata } from '@/services/policy/policy-api';

/** 回放捕获里程碑（M1）——只落漂移检测地基 hash，trace 明文 payload 待 M2 PII envelope。 */
export const REPLAY_CAPTURE_MILESTONE_M1 = 'p0a.m1';
/** M1 未落 trace/replay payload 的显式原因（回归工具据此知道行级回放材料不全）。 */
export const REPLAY_PAYLOAD_NOT_CAPTURED_M1 = 'REPLAY_PAYLOAD_NOT_CAPTURED_M1';
/** 行级回放完整性状态：不完整（M1 恒此值——缺 trace payload，见 buildReplayColumns doc）。 */
export const STATUS_NON_REPLAYABLE = 'NON_REPLAYABLE';

/**
 * 回放列取值（ADR 0030 附录 A）——把 aster-api 的 replayMetadata + 不可变 PolicyVersion 字段
 * 映射成 Execution 回放列的 insert 片段。两个 execute 写路径共用，保证口径一致。
 *
 * <p><b>M1 语义（Codex 设计审 #2）：</b>本里程碑只落「漂移检测地基」（canonical hash + 工具链
 * + status/reasons），**不**落 trace 明文 / replayPayload*（PII envelope 待 M2 KMS）。因此：
 * <ul>
 *   <li><b>replayCaptureVersion 留 null</b>——schema 不变式「replayCaptureVersion 非空→其余列
 *       全 set」，若置非 null 而 payload 列空会让回归工具误判「完整可回放」。用 canonicalizationVersion
 *       + hashes 表达「hash 地基完整」，replayCaptureVersion 专表「完整 capture」（M2 才置）。</li>
 *   <li><b>replayabilityStatus 行级恒 NON_REPLAYABLE</b>（Codex 复审 #3）——即使后端 hash
 *       地基完整报 REPLAYABLE，本行仍缺 trace payload（M2 才落），行级回放材料不全。
 *       {@code replayabilityStatus_idx} 是回归工具筛 REPLAYABLE 的入口；若写 REPLAYABLE 会被
 *       选中却读不到完整材料。后端原状态保留进 reasons（{@code backend_status=...}）供追溯。</li>
 *   <li>replayabilityReasons 追加 {@link REPLAY_PAYLOAD_NOT_CAPTURED_M1}，显式告知行级回放
 *       材料不全（trace payload 未存）。</li>
 *   <li>replayPayload* / traceJson / piiRetentionUntil / piiPolicyVersion 全 null。</li>
 * </ul>
 *
 * <p>replayMetadata 缺失（未开 capture / 后端未返回）→ 回放列全 null（该行不参与回放聚合），
 * 不阻断 Execution 写入（执行成功就该记录，回放是增强非前提）。
 */
export interface ReplayVersionRefs {
  /** 不可变 PolicyVersion 行 id（Execution.policyVersionRowId）。 */
  policyVersionRowId: string | null;
  /** PolicyVersion.sourceToolchainId（envelope 编译工具链）。 */
  sourceToolchainId: string | null;
  /** PolicyVersion.vocabularySnapshotIds（不可变引用）。 */
  vocabSnapshotRef: unknown;
  /** 执行时实际 locale。 */
  locale: string | null;
  /** 冻结 aliasSet（无别名传 {} 非 null；未捕获传 null）。 */
  aliasSetJson: unknown;
  /** 实际执行的 function 名。 */
  functionName: string | null;
}

/** Execution 回放列 insert 片段（drizzle 列名）。 */
export interface ExecutionReplayColumns {
  policyVersionRowId: string | null;
  functionName: string | null;
  locale: string | null;
  aliasSetJson: unknown;
  vocabSnapshotRef: unknown;
  sourceToolchainId: string | null;
  runtimeToolchainId: string | null;
  reasonCodes: unknown;
  traceJson: unknown;
  traceHash: string | null;
  canonicalInputHash: string | null;
  canonicalOutputHash: string | null;
  canonicalizationVersion: string | null;
  replayCaptureVersion: string | null;
  replayabilityStatus: string | null;
  replayabilityReasons: unknown;
  replayPayloadCiphertext: string | null;
  replayPayloadAlg: string | null;
  replayPayloadKeyId: string | null;
  replayPayloadNonce: string | null;
  replayPayloadHash: string | null;
  piiRetentionUntil: Date | null;
  piiPolicyVersion: string | null;
}

/**
 * 构建 Execution 回放列（M1）。见 {@link ReplayVersionRefs} doc 的 M1 语义。
 */
export function buildReplayColumns(
  replay: PolicyReplayMetadata | undefined,
  refs: ReplayVersionRefs
): ExecutionReplayColumns {
  // 版本引用列总是可填（不依赖 replayMetadata）——即使未开 capture，记录执行时的不可变版本引用
  // 仍有审计价值。回放 hash 列则依赖 replayMetadata。
  const base: ExecutionReplayColumns = {
    policyVersionRowId: refs.policyVersionRowId,
    functionName: refs.functionName,
    locale: refs.locale,
    aliasSetJson: refs.aliasSetJson,
    vocabSnapshotRef: refs.vocabSnapshotRef ?? null,
    sourceToolchainId: refs.sourceToolchainId,
    runtimeToolchainId: null,
    reasonCodes: null,
    traceJson: null,
    traceHash: null,
    canonicalInputHash: null,
    canonicalOutputHash: null,
    canonicalizationVersion: null,
    // ★M1 留 null（见 doc）：不假装完整 capture。
    replayCaptureVersion: null,
    replayabilityStatus: null,
    replayabilityReasons: null,
    replayPayloadCiphertext: null,
    replayPayloadAlg: null,
    replayPayloadKeyId: null,
    replayPayloadNonce: null,
    replayPayloadHash: null,
    piiRetentionUntil: null,
    piiPolicyVersion: null,
  };

  if (!replay) {
    return base;
  }

  // 后端权威 hash + 工具链。M1 追加 payload-not-captured 原因 + 保留后端原状态供追溯。
  const reasons = Array.isArray(replay.replayabilityReasons)
    ? [...replay.replayabilityReasons]
    : [];
  reasons.push(REPLAY_PAYLOAD_NOT_CAPTURED_M1);
  if (replay.replayabilityStatus) {
    // 后端 hash 地基完整性状态保留供追溯——但不作为行级 replayabilityStatus（见下）。
    reasons.push(`backend_status=${replay.replayabilityStatus}`);
  }

  return {
    ...base,
    runtimeToolchainId: replay.runtimeToolchainId ?? null,
    reasonCodes: Array.isArray(replay.reasonCodes) ? replay.reasonCodes : null,
    traceHash: replay.traceHash ?? null,
    canonicalInputHash: replay.canonicalInputHash ?? null,
    canonicalOutputHash: replay.canonicalOutputHash ?? null,
    canonicalizationVersion: replay.canonicalizationVersion ?? null,
    // ★行级恒 NON_REPLAYABLE（Codex 复审 #3）：即使后端 hash 地基完整报 REPLAYABLE，本行仍缺
    // trace payload（M2 才落），行级回放材料不全。replayabilityStatus_idx 是回归工具筛
    // REPLAYABLE 的入口——写 REPLAYABLE 会被选中却读不到完整材料。hash 地基完整性由
    // canonicalizationVersion + canonical*Hash + traceHash 表达，不靠此列。
    replayabilityStatus: STATUS_NON_REPLAYABLE,
    replayabilityReasons: reasons,
  };
}

type ExecutionSource = InferSelectModel<typeof executions>['source'];
type ExecutionDecision = InferSelectModel<typeof executions>['decision'];

export interface ExecutionLogItem {
  id: string;
  policyId: string;
  policyName: string;
  policyVersion: number | null;
  input: unknown;
  output: unknown;
  error: string | null;
  success: boolean;
  /** 准入决策语义（approved/denied/indeterminate/error）。历史行为 null。 */
  decision: ExecutionDecision;
  durationMs: number;
  source: ExecutionSource;
  metadata: unknown;
  createdAt: Date;
}

export interface ExecutionLogQuery {
  userId: string;
  policyId?: string;
  success?: boolean;
  /** 按准入决策过滤（可选）。 */
  decision?: ExecutionDecision;
  source?: ExecutionSource;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

export interface ExecutionLogResult {
  items: ExecutionLogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ExecutionStats {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  /** 无决策（值/计算输出，如 greet 返回文本）的执行数——不计入失败。 */
  indeterminateCount: number;
  successRate: number;
  avgDurationMs: number;
  bySource: {
    source: ExecutionSource;
    count: number;
  }[];
  recentTrend: {
    date: string;
    successCount: number;
    failureCount: number;
  }[];
}

/**
 * 查询执行日志（分页）
 */
export async function queryExecutionLogs(query: ExecutionLogQuery): Promise<ExecutionLogResult> {
  const { userId, policyId, success, decision, source, startDate, endDate, page = 1, pageSize = 20 } = query;

  // Build where conditions
  const conditions = [eq(executions.userId, userId)];
  if (policyId) conditions.push(eq(executions.policyId, policyId));
  if (success !== undefined) conditions.push(eq(executions.success, success));
  if (decision) conditions.push(eq(executions.decision, decision));
  if (source) conditions.push(eq(executions.source, source));
  if (startDate) conditions.push(gte(executions.createdAt, startDate));
  if (endDate) conditions.push(lte(executions.createdAt, endDate));

  const whereClause = and(...conditions);

  const [items, totalResult] = await Promise.all([
    db.query.executions.findMany({
      where: whereClause,
      orderBy: [desc(executions.createdAt)],
      offset: (page - 1) * pageSize,
      limit: pageSize,
      with: {
        policy: {
          columns: {
            name: true,
            deletedAt: true,
          },
        },
      },
    }),
    db.select({ count: sql<number>`count(*)::int` })
      .from(executions)
      .where(whereClause),
  ]);

  const total = totalResult[0]?.count || 0;

  // Filter out executions with deleted policies
  const filteredItems = items.filter(item => !item.policy.deletedAt);

  return {
    items: filteredItems.map((item) => ({
      id: item.id,
      policyId: item.policyId,
      policyName: item.policy.name,
      policyVersion: item.policyVersion,
      input: item.input,
      output: item.output,
      error: item.error,
      success: item.success,
      decision: item.decision,
      durationMs: item.durationMs,
      source: item.source,
      metadata: item.metadata,
      createdAt: item.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 获取单个执行日志详情
 */
export async function getExecutionLogDetail(
  executionId: string,
  userId: string
): Promise<ExecutionLogItem | null> {
  const item = await db.query.executions.findFirst({
    where: and(
      eq(executions.id, executionId),
      eq(executions.userId, userId)
    ),
    with: {
      policy: {
        columns: {
          name: true,
        },
      },
    },
  });

  if (!item) return null;

  return {
    id: item.id,
    policyId: item.policyId,
    policyName: item.policy.name,
    policyVersion: item.policyVersion,
    input: item.input,
    output: item.output,
    error: item.error,
    success: item.success,
    decision: item.decision,
    durationMs: item.durationMs,
    source: item.source,
    metadata: item.metadata,
    createdAt: item.createdAt,
  };
}

/**
 * 获取策略执行统计
 */
export async function getExecutionStats(
  userId: string,
  policyId?: string,
  days: number = 30
): Promise<ExecutionStats> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Build where conditions
  const conditions = [
    eq(executions.userId, userId),
    gte(executions.createdAt, startDate),
  ];
  if (policyId) conditions.push(eq(executions.policyId, policyId));

  const whereClause = and(...conditions);
  const whereWithSuccess = and(...conditions, eq(executions.success, true));
  // indeterminate（值/计算输出）：执行成功但无 allow/deny 语义，**不应计入失败**。
  const whereIndeterminate = and(...conditions, eq(executions.decision, 'indeterminate'));

  // 基础统计
  const [totalResult, successResult, indeterminateResult, executionsList] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(executions)
      .where(whereClause),
    db.select({ count: sql<number>`count(*)::int` })
      .from(executions)
      .where(whereWithSuccess),
    db.select({ count: sql<number>`count(*)::int` })
      .from(executions)
      .where(whereIndeterminate),
    db.query.executions.findMany({
      where: whereClause,
      columns: {
        success: true,
        decision: true,
        durationMs: true,
        source: true,
        createdAt: true,
      },
      with: {
        policy: {
          columns: {
            deletedAt: true,
          },
        },
      },
    }),
  ]);

  const totalExecutions = totalResult[0]?.count || 0;
  const successCount = successResult[0]?.count || 0;
  const indeterminateCount = indeterminateResult[0]?.count || 0;
  // Filter out executions with deleted policies
  const executionData = executionsList.filter(e => !e.policy.deletedAt);

  // 失败 = 总数 - 通过(approved) - 无决策(indeterminate 值输出)。修复：此前 total-approved
  // 把值输出策略误计入失败。真实拒绝/错误才算失败。successRate 分母排除 indeterminate
  // （值输出不参与"准入通过率"，否则会稀释真实决策的通过率）。
  const failureCount = Math.max(0, totalExecutions - successCount - indeterminateCount);
  const decisionTotal = totalExecutions - indeterminateCount;
  const successRate = decisionTotal > 0 ? (successCount / decisionTotal) * 100 : 0;
  const avgDurationMs =
    executionData.length > 0
      ? executionData.reduce((sum, e) => sum + e.durationMs, 0) / executionData.length
      : 0;

  // 按来源统计
  const sourceStats = new Map<ExecutionSource, number>();
  for (const exec of executionData) {
    sourceStats.set(exec.source, (sourceStats.get(exec.source) || 0) + 1);
  }
  const bySource = Array.from(sourceStats.entries()).map(([source, count]) => ({
    source,
    count,
  }));

  // 最近 7 天趋势
  const trendDays = Math.min(days, 7);
  const trendMap = new Map<string, { successCount: number; failureCount: number }>();

  for (let i = 0; i < trendDays; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    trendMap.set(dateStr, { successCount: 0, failureCount: 0 });
  }

  for (const exec of executionData) {
    const dateStr = exec.createdAt.toISOString().slice(0, 10);
    if (trendMap.has(dateStr)) {
      const trend = trendMap.get(dateStr)!;
      if (exec.success) {
        trend.successCount++;
      } else if (exec.decision !== 'indeterminate') {
        // 无决策（值输出）不计入失败趋势；真实拒绝/错误才算失败。
        trend.failureCount++;
      }
    }
  }

  const recentTrend = Array.from(trendMap.entries())
    .map(([date, counts]) => ({
      date,
      ...counts,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalExecutions,
    successCount,
    failureCount,
    indeterminateCount,
    successRate: Math.round(successRate * 100) / 100,
    avgDurationMs: Math.round(avgDurationMs),
    bySource,
    recentTrend,
  };
}

/**
 * 获取策略的最近执行记录
 */
export async function getRecentExecutions(
  policyId: string,
  userId: string,
  limit: number = 10
): Promise<ExecutionLogItem[]> {
  const items = await db.query.executions.findMany({
    where: and(
      eq(executions.policyId, policyId),
      eq(executions.userId, userId)
    ),
    orderBy: [desc(executions.createdAt)],
    limit,
    with: {
      policy: {
        columns: {
          name: true,
        },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    policyId: item.policyId,
    policyName: item.policy.name,
    policyVersion: item.policyVersion,
    input: item.input,
    output: item.output,
    error: item.error,
    success: item.success,
    decision: item.decision,
    durationMs: item.durationMs,
    source: item.source,
    metadata: item.metadata,
    createdAt: item.createdAt,
  }));
}

/**
 * 创建执行日志（增强版）
 */
export async function createExecutionLog(data: {
  userId: string;
  policyId: string;
  policyVersion?: number;
  input: unknown;
  output?: unknown;
  error?: string;
  success: boolean;
  durationMs: number;
  source: ExecutionSource;
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    apiKeyId?: string;
    [key: string]: unknown;
  };
}): Promise<string> {
  const [execution] = await db.insert(executions).values({
    id: crypto.randomUUID(),
    userId: data.userId,
    policyId: data.policyId,
    policyVersion: data.policyVersion ?? null,
    input: data.input as object,
    output: (data.output as object | null) ?? null,
    error: data.error ?? null,
    success: data.success,
    durationMs: data.durationMs,
    source: data.source,
    apiKeyId: (data.metadata?.apiKeyId as string | null) ?? null,
    metadata: (data.metadata as object | null) ?? null,
  }).returning();

  return execution.id;
}

/**
 * 删除旧的执行日志（保留最近 N 天）
 * 应由定时任务调用
 */
export async function cleanupOldExecutionLogs(
  retentionDays: number = 90
): Promise<{ deletedCount: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await db.delete(executions)
    .where(lt(executions.createdAt, cutoffDate))
    .returning();

  return { deletedCount: result.length };
}

// 证据导出（evidence export）领域类型。
//
// 「证据包」= 从**真实执行链**导出的可验证证据（decision + canonical 哈希 + 双引擎溯源 +
// replayability），供用户交给自己的合规/审计团队归档。**不含任何假合规分数或硬编码法规建议**——
// 与被替换的旧 compliance-score 报告根本不同：这里只呈现执行链**已经产生**的权威事实。

import type { ExecutionSource } from '@/lib/prisma';

/** 执行决策四态（与 executionDecisionEnum 一致）；legacy 行可能为 null → 归入 'unknown' 统计桶。 */
export type EvidenceDecision = 'approved' | 'denied' | 'indeterminate' | 'error';

/** decision 分布统计（含 unknown 桶容纳 legacy decision=null 行）。 */
export interface DecisionTally {
  approved: number;
  denied: number;
  indeterminate: number;
  error: number;
  unknown: number;
}

/**
 * 单条执行的证据条目。全部来自 executions 表已存的权威字段——哈希由 aster-api 计算，cloud 只搬运。
 * **不含明文 input/output/traceJson**（PII）；只含可交叉验证的哈希 + 溯源。legacy 行哈希/decision 可能为 null。
 */
export interface EvidenceEntry {
  executionId: string;
  policyId: string;
  policyVersion: number | null;
  /** 不可变版本行引用（可精确定位当时编译产物）。 */
  policyVersionRowId: string | null;
  decision: EvidenceDecision | null;
  canonicalInputHash: string | null;
  canonicalOutputHash: string | null;
  traceHash: string | null;
  canonicalizationVersion: string | null;
  /** 双引擎溯源：源/运行时 toolchain id。 */
  toolchain: { source: string | null; runtime: string | null };
  replayabilityStatus: string | null;
  replayabilityReasons: unknown;
  reasonCodes: unknown;
  source: ExecutionSource;
  durationMs: number;
  /** ISO-8601 UTC。 */
  createdAt: string;
}

/** 导出格式。 */
export type EvidenceFormat = 'json' | 'jsonl';

/**
 * 证据包顶层 manifest（自描述 + 防篡改）。bundleHash 对**有序 entries** 的 canonicalHash——
 * 审计方可用同一 canonical 规则重算校验（recipe 见 notes）。manifest 本身不进 bundleHash（避免自引用）。
 */
export interface EvidenceManifest {
  kind: 'evidence-export';
  schemaVersion: '1';
  generatedAt: string;
  /** 单策略快照，或全部策略范围。 */
  policy:
    | { id: string; name: string; version: number | null; policyVersionRowId: string | null }
    | { scope: 'all' };
  range: { start: string | null; end: string | null };
  totals: { count: number };
  decisionTally: DecisionTally;
  canonicalizationVersion: string;
  /** hex sha256（复用 canonicalHash，带 CANONICALIZATION_VERSION 前缀）。 */
  bundleHash: string;
  notes: {
    /** 缺 canonical 哈希的 legacy 行数（导出覆盖缺口，供审计方知情——绝不伪造哈希）。 */
    legacyRowsWithoutHashes: number;
    /** 校验 recipe：告诉审计方如何重算 bundleHash。 */
    verification: string;
  };
}

/** 完整证据包（manifest + 有序 entries）。 */
export interface EvidenceBundle {
  manifest: EvidenceManifest;
  entries: EvidenceEntry[];
}

/** 预览（导出前给 UI 看规模，不含行体）。 */
export interface EvidencePreview {
  count: number;
  decisionTally: DecisionTally;
  /**
   * 哈希覆盖率：verifiable=有 canonical 哈希的条数（真可验证证据）；legacy=无哈希（早于 ADR 0030
   * 哈希采集接线的历史执行，导出会是 null 字段）。让用户看清这批里多少条真有证据。
   */
  coverage: { verifiable: number; legacy: number };
  /** 是否超过导出行数上限（超则不允许导出，提示用户缩小范围）。 */
  exceedsLimit: boolean;
  limit: number;
}

/** 导出请求参数。 */
export interface EvidenceExportRequest {
  /** undefined = 全部策略。 */
  policyId?: string;
  startDate?: Date;
  endDate?: Date;
  format: EvidenceFormat;
  /** 仅导有可验证哈希的执行（排除 legacy 无哈希行）。默认 false=导全部。 */
  verifiableOnly?: boolean;
}

// src/services/policy/rule-regression-runner.ts
// P0-A 规则集升级回归工具 M1 缩版 runner（ADR 0030 附录 B）。
//
// 职责：把历史 Execution + 手写边界 case 冻结成不可变 RegressionCase（golden），升级后对
// 当前后端回放，canonical-diff 输出 hash 检测漂移，出四态报告（落 RegressionReport 审计）。
//
// ★M1 comparisonMode 恒 FROZEN_BASELINE_VS_CURRENT_BACKEND（单后端约束，见附录 B.1）：
// 基线 expectedOutputHash 是冻结时捕获的快照，M1 不实时重跑 old backend/toolchain。这是试点
// 实际操作方式（升级前 freeze → 部署新版 → run gate），诚实标注不假装实时对跑。

import { and, eq, sql } from 'drizzle-orm';
import { db, policyVersions, regressionCases, regressionReports, users } from '@/lib/prisma';
import { canonicalHash } from '@/lib/canonical-json';
import { createPolicyApiClient } from './policy-api';
import { detectCNLLocale } from './cnl-executor';

/** runner 版本——进 reportHash，保证报告可复算归因到 runner 逻辑版本。 */
export const RULE_REGRESSION_RUNNER_VERSION = 'p0a-runner/m1.0';

/** M1 单后端比对模式（诚实标注：基线=冻结快照 hash，非实时重跑 old backend）。 */
export const COMPARISON_MODE_FROZEN_BASELINE = 'FROZEN_BASELINE_VS_CURRENT_BACKEND';

/** 报告四态。 */
export type RegressionReportStatus =
  | 'PASS'
  | 'FAIL_REGRESSION'
  | 'FAIL_INSUFFICIENT_COVERAGE'
  | 'NON_REPLAYABLE';

/** case 级回放结果。 */
export type CaseRunStatus = 'PASS' | 'FAIL_REGRESSION' | 'NON_REPLAYABLE';

export interface CoverageThresholds {
  minRunnableCases: number;
  minApprovedCases: number;
  minDeniedCases: number;
  minHandwrittenBoundaryCases: number;
}

/** M1 默认覆盖阈值（ADR 附录 B.4）。 */
export const DEFAULT_THRESHOLDS: CoverageThresholds = {
  minRunnableCases: 4,
  minApprovedCases: 1,
  minDeniedCases: 1,
  minHandwrittenBoundaryCases: 1,
};

export interface HandwrittenCaseInput {
  policyVersionRowId: string;
  functionName: string;
  locale?: string;
  input: Record<string, unknown> | unknown[];
  coverageTags: string[];
}

export interface FreezeResult {
  frozen: number;
  duplicate: number;
  skipped: number;
  /**
   * 冲突：同 (versionRow,function,locale,canonicalInput) 已有 case 但 expectedOutputHash 不同
   * ——同一输入历史上产过不同输出=漂移信号（Codex 复审 #3）。不静默吞（DO NOTHING 会），显式暴露。
   */
  outputConflicts: Array<{
    canonicalInputHash: string;
    functionName: string;
    locale: string;
    existingExpectedOutputHash: string;
    candidateExpectedOutputHash: string;
  }>;
  caseIds: string[];
  /** 跳过原因明细（诊断用）。 */
  skippedReasons: string[];
}

/** 检测同 unique key 的已有 case 是否 expectedOutputHash 不同（漂移信号）。 */
async function detectOutputConflict(
  policyVersionRowId: string,
  functionName: string,
  locale: string,
  canonicalInputHash: string,
  candidateExpectedOutputHash: string
): Promise<FreezeResult['outputConflicts'][number] | null> {
  const existing = await db.query.regressionCases.findFirst({
    where: and(
      eq(regressionCases.policyVersionRowId, policyVersionRowId),
      eq(regressionCases.functionName, functionName),
      eq(regressionCases.locale, locale),
      eq(regressionCases.canonicalInputHash, canonicalInputHash)
    ),
    columns: { expectedOutputHash: true },
  });
  if (existing && existing.expectedOutputHash !== candidateExpectedOutputHash) {
    return {
      canonicalInputHash,
      functionName,
      locale,
      existingExpectedOutputHash: existing.expectedOutputHash,
      candidateExpectedOutputHash,
    };
  }
  return null;
}

export interface CaseRunDetail {
  caseId: string;
  status: CaseRunStatus;
  expectedInputHash?: string;
  actualInputHash?: string;
  expectedOutputHash?: string;
  actualOutputHash?: string;
  expectedDecision?: string | null;
  functionName: string;
  locale: string;
  coverageTags: string[];
  sourceKind: string;
  reason?: string;
}

export interface RunReport {
  reportId: string;
  reportHash: string;
  status: RegressionReportStatus;
  comparisonMode: string;
  baselineSemantics: string;
  policyId: string;
  policyVersionRowId: string;
  currentRuntimeToolchainId: string | null;
  coverage: {
    totalCases: number;
    runnableCases: number;
    approvedCases: number;
    deniedCases: number;
    handwrittenBoundaryCases: number;
    thresholds: CoverageThresholds;
    unmet: string[];
  };
  summary: {
    passed: number;
    failed: number;
    nonReplayable: number;
    compileFailures: number;
  };
  cases: CaseRunDetail[];
  runnerVersion: string;
}

const BASELINE_SEMANTICS =
  'expectedOutputHash was captured at freeze time under the baseline toolchain; ' +
  'M1 does not re-run the old backend/toolchain during report generation ' +
  '(single-backend constraint). Deploy the new version, then run the gate.';

/**
 * caseHash = canonicalHash(核心不可变字段)——防篡改 + 去重锚。覆盖决定「同一 golden」的所有
 * 字段（版本行/函数/locale/canonical input/expected output/别名/词汇/canonicalization 版本）。
 * 不含 createdAt/createdBy/id（非决定性/身份字段）。
 */
export function computeCaseHash(fields: {
  policyVersionRowId: string;
  functionName: string;
  locale: string;
  canonicalInputHash: string;
  expectedOutputHash: string;
  canonicalizationVersion: string;
  aliasSetJson: unknown;
  vocabSnapshotRef: unknown;
  sourceKind: string;
}): string {
  return canonicalHash({
    policyVersionRowId: fields.policyVersionRowId,
    functionName: fields.functionName,
    locale: fields.locale,
    canonicalInputHash: fields.canonicalInputHash,
    expectedOutputHash: fields.expectedOutputHash,
    canonicalizationVersion: fields.canonicalizationVersion,
    aliasSetJson: fields.aliasSetJson ?? {},
    vocabSnapshotRef: fields.vocabSnapshotRef ?? [],
    sourceKind: fields.sourceKind,
  });
}

/**
 * reportHash = canonicalHash(报告决定性内容)——报告防篡改 + 可复算。覆盖 toolchain + case ids +
 * 逐 case 期望/实际 hash + 覆盖 + runner 版本。不含 reportId/createdAt（身份/时间）。
 */
export function computeReportHash(report: Omit<RunReport, 'reportId' | 'reportHash'>): string {
  return canonicalHash({
    status: report.status,
    comparisonMode: report.comparisonMode,
    policyId: report.policyId,
    policyVersionRowId: report.policyVersionRowId,
    currentRuntimeToolchainId: report.currentRuntimeToolchainId,
    coverage: report.coverage,
    summary: report.summary,
    runnerVersion: report.runnerVersion,
    cases: report.cases.map((c) => ({
      caseId: c.caseId,
      status: c.status,
      expectedInputHash: c.expectedInputHash ?? null,
      actualInputHash: c.actualInputHash ?? null,
      expectedOutputHash: c.expectedOutputHash ?? null,
      actualOutputHash: c.actualOutputHash ?? null,
    })),
  });
}

/** tenant（=userId）是否开启回放留存（PII opt-in，ADR pii-admission/v1）。 */
async function isReplayRetentionEnabled(userId: string): Promise<boolean> {
  const u = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { replayRetentionEnabled: true },
  });
  return u?.replayRetentionEnabled ?? false;
}

/**
 * 从 Execution 冻结候选为 RegressionCase。
 *
 * ★候选谓词不筛 replayabilityStatus（M1 行级恒 NON_REPLAYABLE），筛非空 canonical hash 地基。
 * DISTINCT ON 同 (versionRow,function,locale,canonicalInput) 保最新一条。插入 ON CONFLICT DO
 * NOTHING 幂等。inputJson 仅 tenant opt-in 时存明文（否则 null → case replay-limited）。
 *
 * @param actorUserId 触发的 admin（createdBy）
 * @param ownerUserId 策略所属 tenant（决定 replayRetention opt-in）；不传则用 actorUserId
 */
export async function freezeFromExecutions(params: {
  policyId: string;
  policyVersionRowId?: string;
  limit?: number;
  actorUserId: string;
  ownerUserId?: string;
}): Promise<FreezeResult> {
  const { policyId, policyVersionRowId, actorUserId } = params;
  const limit = params.limit ?? 100;
  const ownerUserId = params.ownerUserId ?? actorUserId;
  const retentionEnabled = await isReplayRetentionEnabled(ownerUserId);

  // 候选谓词（ADR 附录 B.3）：canonical hash 地基完整 + 有回放上下文 + 无错误。
  // DISTINCT ON 去重同一 canonical input（保最新）。参数化防注入。
  const candidates = (await db.execute(sql`
    SELECT DISTINCT ON (
      e."policyVersionRowId", e."functionName", e."locale", e."canonicalInputHash"
    )
      e."id" AS "sourceExecutionId",
      e."policyId",
      e."policyVersionRowId",
      e."policyVersion",
      e."functionName",
      e."locale",
      COALESCE(e."aliasSetJson"::jsonb, '{}'::jsonb) AS "aliasSetJson",
      COALESCE(e."vocabSnapshotRef"::jsonb, '[]'::jsonb) AS "vocabSnapshotRef",
      e."input" AS "inputJson",
      e."canonicalInputHash",
      e."canonicalOutputHash" AS "expectedOutputHash",
      e."decision" AS "expectedDecision",
      e."canonicalizationVersion",
      e."runtimeToolchainId" AS "baselineRuntimeToolchainId",
      e."sourceToolchainId",
      pv."sourceEnvelopeSha256"
    FROM "Execution" e
    JOIN "PolicyVersion" pv ON pv."id" = e."policyVersionRowId"
    WHERE e."policyId" = ${policyId}
      AND (${policyVersionRowId ?? null}::text IS NULL OR e."policyVersionRowId" = ${policyVersionRowId ?? null})
      AND e."policyVersionRowId" IS NOT NULL
      AND e."functionName" IS NOT NULL
      AND e."locale" IS NOT NULL
      AND e."canonicalizationVersion" IS NOT NULL
      AND e."canonicalInputHash" IS NOT NULL
      AND e."canonicalOutputHash" IS NOT NULL
      AND e."input" IS NOT NULL
      AND e."error" IS NULL
    ORDER BY
      e."policyVersionRowId", e."functionName", e."locale", e."canonicalInputHash",
      e."createdAt" DESC
    LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;

  const result: FreezeResult = { frozen: 0, duplicate: 0, skipped: 0, outputConflicts: [], caseIds: [], skippedReasons: [] };

  for (const c of candidates) {
    const caseHash = computeCaseHash({
      policyVersionRowId: String(c.policyVersionRowId),
      functionName: String(c.functionName),
      locale: String(c.locale),
      canonicalInputHash: String(c.canonicalInputHash),
      expectedOutputHash: String(c.expectedOutputHash),
      canonicalizationVersion: String(c.canonicalizationVersion),
      aliasSetJson: c.aliasSetJson,
      vocabSnapshotRef: c.vocabSnapshotRef,
      sourceKind: 'execution',
    });

    const inserted = await db
      .insert(regressionCases)
      .values({
        id: crypto.randomUUID(),
        policyId: String(c.policyId),
        policyVersionRowId: String(c.policyVersionRowId),
        policyVersion: c.policyVersion == null ? null : Number(c.policyVersion),
        functionName: String(c.functionName),
        locale: String(c.locale),
        aliasSetJson: (c.aliasSetJson as object) ?? {},
        vocabSnapshotRef: (c.vocabSnapshotRef as object) ?? [],
        // ★PII opt-in：仅 tenant 开留存时存明文 input；否则 null（replay-limited）。
        inputJson: retentionEnabled ? (c.inputJson as object) : null,
        canonicalInputHash: String(c.canonicalInputHash),
        expectedOutputHash: String(c.expectedOutputHash),
        expectedDecision: c.expectedDecision == null ? null : String(c.expectedDecision),
        canonicalizationVersion: String(c.canonicalizationVersion),
        sourceKind: 'execution',
        sourceExecutionId: String(c.sourceExecutionId),
        coverageTags: [],
        baselineRuntimeToolchainId:
          c.baselineRuntimeToolchainId == null ? null : String(c.baselineRuntimeToolchainId),
        sourceToolchainId: c.sourceToolchainId == null ? null : String(c.sourceToolchainId),
        sourceEnvelopeSha256: c.sourceEnvelopeSha256 == null ? null : String(c.sourceEnvelopeSha256),
        caseHash,
        createdBy: actorUserId,
      })
      // 幂等：同 (versionRow,function,locale,canonicalInput) 已存在则跳过。
      .onConflictDoNothing({
        target: [
          regressionCases.policyVersionRowId,
          regressionCases.functionName,
          regressionCases.locale,
          regressionCases.canonicalInputHash,
        ],
      })
      .returning({ id: regressionCases.id });

    if (inserted.length > 0) {
      result.frozen++;
      result.caseIds.push(inserted[0].id);
    } else {
      // 冲突：查已有 case 是否 expectedOutputHash 不同（同 input 历史产不同 output=漂移信号）。
      // 不静默计 duplicate 吞掉证据（Codex 复审 #3）。
      const conflict = await detectOutputConflict(
        String(c.policyVersionRowId),
        String(c.functionName),
        String(c.locale),
        String(c.canonicalInputHash),
        String(c.expectedOutputHash)
      );
      if (conflict) {
        result.outputConflicts.push(conflict);
      } else {
        result.duplicate++;
      }
    }
  }

  return result;
}

/**
 * 用当前后端评估一个 source+input，返回权威 replayMetadata（canonical hashes + toolchain）。
 * 走 HMAC 内部调用 + replayCapture=true。失败抛（调用方决定如何处理）。
 */
async function evaluateForCapture(params: {
  tenantId: string;
  actorUserId: string;
  source: string;
  input: Record<string, unknown> | unknown[];
  locale: string;
  functionName: string;
  aliasSet: Record<string, string[]> | null;
}): Promise<{
  canonicalInputHash: string | null;
  canonicalOutputHash: string | null;
  runtimeToolchainId: string | null;
  canonicalizationVersion: string | null;
}> {
  const client = createPolicyApiClient(params.tenantId, params.actorUserId);
  const resp = await client.evaluateSource(params.source, params.input, {
    locale: params.locale,
    functionName: params.functionName,
    aliasSet: params.aliasSet,
    replayCapture: true,
  });
  const rm = resp.replayMetadata;
  return {
    canonicalInputHash: rm?.canonicalInputHash ?? null,
    canonicalOutputHash: rm?.canonicalOutputHash ?? null,
    runtimeToolchainId: rm?.runtimeToolchainId ?? null,
    canonicalizationVersion: rm?.canonicalizationVersion ?? null,
  };
}

/**
 * 解析 PolicyVersion 的冻结 aliasSet（canonical JSON 串）→ Map。损坏视为无别名。
 */
function parseAliasSet(aliasSetRaw: string | null): Record<string, string[]> | null {
  if (!aliasSetRaw) return null;
  try {
    return JSON.parse(aliasSetRaw) as Record<string, string[]>;
  } catch {
    return null;
  }
}

/**
 * 冻结作者手写边界 case（ADR 附录 B.5 freeze.handwrittenCases）。
 *
 * 每个 case 用**当前后端**对对应 PolicyVersion.content 评估一次，取权威 canonical hashes 作为
 * expectedOutputHash 基线冻结。手写 case 目标是覆盖历史未跑到的边界（threshold/null/rounding）。
 * inputJson 同样受 tenant opt-in 约束。
 */
export async function freezeHandwritten(params: {
  policyId: string;
  cases: HandwrittenCaseInput[];
  actorUserId: string;
  ownerUserId?: string;
  tenantId: string;
}): Promise<FreezeResult> {
  const { policyId, cases, actorUserId, tenantId } = params;
  const ownerUserId = params.ownerUserId ?? actorUserId;
  const retentionEnabled = await isReplayRetentionEnabled(ownerUserId);
  const result: FreezeResult = { frozen: 0, duplicate: 0, skipped: 0, outputConflicts: [], caseIds: [], skippedReasons: [] };

  for (const hc of cases) {
    // 载入版本内容 + 冻结 aliasSet + toolchain。★版本行必须属于本 policyId（Codex 复审 #2）：
    // 否则 handwritten case 可用 B 版本源码评估却存成 policyId=A → 跨 policy/tenant 证据混淆。
    const pv = await db.query.policyVersions.findFirst({
      where: and(eq(policyVersions.id, hc.policyVersionRowId), eq(policyVersions.policyId, policyId)),
      columns: {
        id: true,
        content: true,
        aliasSet: true,
        sourceToolchainId: true,
        sourceEnvelopeSha256: true,
        vocabularySnapshotIds: true,
        version: true,
      },
    });
    if (!pv) {
      result.skipped++;
      result.skippedReasons.push(`version_not_found_or_policy_mismatch:${hc.policyVersionRowId}`);
      continue;
    }

    const locale = hc.locale ?? detectCNLLocale(pv.content);
    const aliasSet = parseAliasSet(pv.aliasSet);

    let captured;
    try {
      captured = await evaluateForCapture({
        tenantId,
        actorUserId,
        source: pv.content,
        input: hc.input,
        locale,
        functionName: hc.functionName,
        aliasSet,
      });
    } catch (e) {
      result.skipped++;
      result.skippedReasons.push(
        `evaluate_failed:${hc.functionName}:${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }

    // 缺权威 hash（后端未返回 replayMetadata / 非 HMAC 调用）→ 无法冻结基线，跳过。
    if (!captured.canonicalInputHash || !captured.canonicalOutputHash || !captured.canonicalizationVersion) {
      result.skipped++;
      result.skippedReasons.push(`missing_replay_metadata:${hc.functionName}`);
      continue;
    }

    const caseHash = computeCaseHash({
      policyVersionRowId: pv.id,
      functionName: hc.functionName,
      locale,
      canonicalInputHash: captured.canonicalInputHash,
      expectedOutputHash: captured.canonicalOutputHash,
      canonicalizationVersion: captured.canonicalizationVersion,
      aliasSetJson: aliasSet ?? {},
      vocabSnapshotRef: pv.vocabularySnapshotIds ?? [],
      sourceKind: 'handwritten',
    });

    const inserted = await db
      .insert(regressionCases)
      .values({
        id: crypto.randomUUID(),
        policyId,
        policyVersionRowId: pv.id,
        policyVersion: pv.version ?? null,
        functionName: hc.functionName,
        locale,
        aliasSetJson: aliasSet ?? {},
        vocabSnapshotRef: pv.vocabularySnapshotIds ?? [],
        inputJson: retentionEnabled ? (hc.input as object) : null,
        canonicalInputHash: captured.canonicalInputHash,
        expectedOutputHash: captured.canonicalOutputHash,
        expectedDecision: null,
        canonicalizationVersion: captured.canonicalizationVersion,
        sourceKind: 'handwritten',
        sourceExecutionId: null,
        // 手写 case 至少带 boundary 标签（覆盖门禁靠它）；调用方传入的 tags 合并。
        coverageTags: hc.coverageTags,
        baselineRuntimeToolchainId: captured.runtimeToolchainId,
        sourceToolchainId: pv.sourceToolchainId ?? null,
        sourceEnvelopeSha256: pv.sourceEnvelopeSha256 ?? null,
        caseHash,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({
        target: [
          regressionCases.policyVersionRowId,
          regressionCases.functionName,
          regressionCases.locale,
          regressionCases.canonicalInputHash,
        ],
      })
      .returning({ id: regressionCases.id });

    if (inserted.length > 0) {
      result.frozen++;
      result.caseIds.push(inserted[0].id);
    } else {
      const conflict = await detectOutputConflict(
        pv.id,
        hc.functionName,
        locale,
        captured.canonicalInputHash,
        captured.canonicalOutputHash
      );
      if (conflict) {
        result.outputConflicts.push(conflict);
      } else {
        result.duplicate++;
      }
    }
  }

  return result;
}

/**
 * 对已冻结的 RegressionCase 跑回归（ADR 附录 B.5 run）。
 *
 * 流程：载入某版本冻结 case → 逐 runnable case 用当前后端 replay → canonical-diff
 * actualOutputHash vs expectedOutputHash → 覆盖门禁 → 四态状态 → 落 RegressionReport。
 *
 * ★状态优先级（ADR 附录 B.4，防假通过）：
 *   1. 无 case 或全不可运行 → NON_REPLAYABLE
 *   2. 覆盖不达标 → FAIL_INSUFFICIENT_COVERAGE
 *   3. 任一 runnable case hash mismatch（或编译/评估失败）→ FAIL_REGRESSION
 *   4. 否则 → PASS
 * 即使全部 match，覆盖不足也不 PASS。
 *
 * replay-limited case（inputJson=null，未开 PII 留存）→ 该 case NON_REPLAYABLE，不计入
 * runnable，不参与 pass/fail（不静默算通过）。
 */
export async function run(params: {
  policyId: string;
  policyVersionRowId: string;
  actorUserId: string;
  tenantId: string;
  thresholds?: Partial<CoverageThresholds>;
}): Promise<RunReport> {
  const { policyId, policyVersionRowId, actorUserId, tenantId } = params;
  const thresholds: CoverageThresholds = { ...DEFAULT_THRESHOLDS, ...params.thresholds };

  // 载入该版本的所有冻结 case。
  const cases = await db.query.regressionCases.findMany({
    where: and(
      eq(regressionCases.policyId, policyId),
      eq(regressionCases.policyVersionRowId, policyVersionRowId)
    ),
  });

  // 载入版本内容（replay 需要 source）。★绑 policyId（Codex 复审 #2）：防消费脏 case 用错 policy 版本。
  const pv = await db.query.policyVersions.findFirst({
    where: and(eq(policyVersions.id, policyVersionRowId), eq(policyVersions.policyId, policyId)),
    columns: { id: true, content: true, aliasSet: true },
  });

  const details: CaseRunDetail[] = [];
  let passed = 0;
  let failed = 0;
  let nonReplayable = 0;
  let compileFailures = 0;
  let currentRuntimeToolchainId: string | null = null;

  const aliasSet = pv ? parseAliasSet(pv.aliasSet) : null;

  for (const c of cases) {
    const base: CaseRunDetail = {
      caseId: c.id,
      status: 'NON_REPLAYABLE',
      expectedInputHash: c.canonicalInputHash,
      expectedOutputHash: c.expectedOutputHash,
      functionName: c.functionName,
      locale: c.locale,
      coverageTags: Array.isArray(c.coverageTags) ? (c.coverageTags as string[]) : [],
      sourceKind: c.sourceKind,
    };

    // replay-limited：无明文 input 无法 replay。
    if (c.inputJson == null) {
      nonReplayable++;
      details.push({ ...base, reason: 'REPLAY_LIMITED_NO_INPUT' });
      continue;
    }
    // 版本内容缺失（版本被删/查不到）→ 无法编译 replay。
    if (!pv) {
      nonReplayable++;
      details.push({ ...base, reason: 'POLICY_VERSION_NOT_FOUND' });
      continue;
    }

    let captured;
    try {
      captured = await evaluateForCapture({
        tenantId,
        actorUserId,
        source: pv.content,
        input: c.inputJson as Record<string, unknown> | unknown[],
        locale: c.locale,
        functionName: c.functionName,
        aliasSet,
      });
    } catch (e) {
      // 编译/评估失败 = 回归（Layer 1 编译漂移）。
      compileFailures++;
      failed++;
      details.push({
        ...base,
        status: 'FAIL_REGRESSION',
        reason: `EVALUATE_FAILED:${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    if (captured.runtimeToolchainId) currentRuntimeToolchainId = captured.runtimeToolchainId;

    // 缺权威 output hash（后端未返回）→ 无法比对，不算通过。
    if (!captured.canonicalOutputHash) {
      nonReplayable++;
      details.push({ ...base, reason: 'MISSING_ACTUAL_OUTPUT_HASH' });
      continue;
    }

    // ★校验 actual input hash（Codex 复审 #1）：证明回放的确是冻结时的同一 canonical input。
    // inputJson 被误写/篡改成另一输入时，即使 output hash 恰好相等也不能算通过——否则回放地基
    // 无法证明「跑的是 golden input」。缺/不等 → FAIL_REGRESSION（回放前提被破坏）。
    if (!captured.canonicalInputHash || captured.canonicalInputHash !== c.canonicalInputHash) {
      failed++;
      details.push({
        ...base,
        status: 'FAIL_REGRESSION',
        actualInputHash: captured.canonicalInputHash ?? undefined,
        actualOutputHash: captured.canonicalOutputHash,
        reason: 'INPUT_HASH_MISMATCH',
      });
      continue;
    }

    const actualOutputHash = captured.canonicalOutputHash;
    if (actualOutputHash === c.expectedOutputHash) {
      passed++;
      details.push({ ...base, status: 'PASS', actualInputHash: captured.canonicalInputHash, actualOutputHash });
    } else {
      failed++;
      details.push({
        ...base,
        status: 'FAIL_REGRESSION',
        actualInputHash: captured.canonicalInputHash,
        actualOutputHash,
        reason: 'OUTPUT_HASH_MISMATCH',
      });
    }
  }

  // 纯决策核心（覆盖门禁 + 状态优先级）——抽出以便单测不需 mock DB/backend。
  const reportBody = assembleReport({
    policyId,
    policyVersionRowId,
    cases: cases.map((c) => ({
      id: c.id,
      expectedDecision: c.expectedDecision,
      sourceKind: c.sourceKind,
      coverageTags: Array.isArray(c.coverageTags) ? (c.coverageTags as string[]) : [],
    })),
    details,
    summary: { passed, failed, nonReplayable, compileFailures },
    currentRuntimeToolchainId,
    thresholds,
  });

  const reportHash = computeReportHash(reportBody);
  const reportId = crypto.randomUUID();
  const { status } = reportBody;
  const { runnableCases } = reportBody.coverage;

  await db.insert(regressionReports).values({
    id: reportId,
    policyId,
    policyVersionRowId,
    status,
    comparisonMode: COMPARISON_MODE_FROZEN_BASELINE,
    caseCount: cases.length,
    runnableCaseCount: runnableCases,
    passedCaseCount: passed,
    failedCaseCount: failed,
    nonReplayableCaseCount: nonReplayable,
    coverageJson: reportBody.coverage,
    reportJson: reportBody as unknown as object,
    reportHash,
    currentRuntimeToolchainId,
    createdBy: actorUserId,
  });

  return { ...reportBody, reportId, reportHash };
}

/** 覆盖统计需要的 case 元信息（纯决策核心用，不含 DB 行全字段）。 */
export interface CaseCoverageMeta {
  id: string;
  expectedDecision: string | null;
  sourceKind: string;
  coverageTags: string[];
}

/**
 * 纯决策核心（ADR 附录 B.4）——覆盖门禁 + 四态状态优先级。抽出以便单测不需 mock DB/backend。
 *
 * ★状态优先级（防假通过）：
 *   1. 无 case 或全不可运行 → NON_REPLAYABLE
 *   2. 覆盖不达标 → FAIL_INSUFFICIENT_COVERAGE
 *   3. 任一 runnable case 失败（hash mismatch / 编译失败）→ FAIL_REGRESSION
 *   4. 否则 → PASS
 * 即使全 match，覆盖不足也不 PASS。
 */
export function assembleReport(params: {
  policyId: string;
  policyVersionRowId: string;
  cases: CaseCoverageMeta[];
  details: CaseRunDetail[];
  summary: { passed: number; failed: number; nonReplayable: number; compileFailures: number };
  currentRuntimeToolchainId: string | null;
  thresholds: CoverageThresholds;
}): Omit<RunReport, 'reportId' | 'reportHash'> {
  const { policyId, policyVersionRowId, cases, details, summary, currentRuntimeToolchainId, thresholds } = params;

  const runnableIds = new Set(
    details.filter((d) => d.status === 'PASS' || d.status === 'FAIL_REGRESSION').map((d) => d.caseId)
  );
  const runnableCases = runnableIds.size;
  const approvedCases = cases.filter((c) => c.expectedDecision === 'approved' && runnableIds.has(c.id)).length;
  const deniedCases = cases.filter((c) => c.expectedDecision === 'denied' && runnableIds.has(c.id)).length;
  const handwrittenBoundaryCases = cases.filter(
    (c) => c.sourceKind === 'handwritten' && c.coverageTags.includes('boundary') && runnableIds.has(c.id)
  ).length;

  const unmet: string[] = [];
  if (runnableCases < thresholds.minRunnableCases)
    unmet.push(`runnable<${thresholds.minRunnableCases} (${runnableCases})`);
  if (approvedCases < thresholds.minApprovedCases)
    unmet.push(`approved<${thresholds.minApprovedCases} (${approvedCases})`);
  if (deniedCases < thresholds.minDeniedCases)
    unmet.push(`denied<${thresholds.minDeniedCases} (${deniedCases})`);
  if (handwrittenBoundaryCases < thresholds.minHandwrittenBoundaryCases)
    unmet.push(`handwrittenBoundary<${thresholds.minHandwrittenBoundaryCases} (${handwrittenBoundaryCases})`);

  let status: RegressionReportStatus;
  if (cases.length === 0 || runnableCases === 0) {
    status = 'NON_REPLAYABLE';
  } else if (unmet.length > 0) {
    status = 'FAIL_INSUFFICIENT_COVERAGE';
  } else if (summary.failed > 0) {
    status = 'FAIL_REGRESSION';
  } else {
    status = 'PASS';
  }

  return {
    status,
    comparisonMode: COMPARISON_MODE_FROZEN_BASELINE,
    baselineSemantics: BASELINE_SEMANTICS,
    policyId,
    policyVersionRowId,
    currentRuntimeToolchainId,
    coverage: {
      totalCases: cases.length,
      runnableCases,
      approvedCases,
      deniedCases,
      handwrittenBoundaryCases,
      thresholds,
      unmet,
    },
    summary,
    cases: details,
    runnerVersion: RULE_REGRESSION_RUNNER_VERSION,
  };
}

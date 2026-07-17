// src/services/policy/rule-regression-runner.ts
// P0-A 规则集升级回归工具 M1 缩版 runner（ADR 0030 附录 B）。
//
// 职责：把历史 Execution + 手写边界 case 冻结成不可变 RegressionCase（golden），升级后对
// 当前后端回放，canonical-diff 输出 hash 检测漂移，出四态报告（落 RegressionReport 审计）。
//
// ★M1 comparisonMode 恒 FROZEN_BASELINE_VS_CURRENT_BACKEND（单后端约束，见附录 B.1）：
// 基线 expectedOutputHash 是冻结时捕获的快照，M1 不实时重跑 old backend/toolchain。这是试点
// 实际操作方式（升级前 freeze → 部署新版 → run gate），诚实标注不假装实时对跑。

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  db,
  policyVersions,
  regressionCases,
  regressionReports,
  regressionDriftApprovals,
  users,
  type RegressionReport,
  type RegressionDriftApproval,
} from '@/lib/prisma';
import { canonicalHash } from '@/lib/canonical-json';
import { createPolicyApiClient } from './policy-api';
import { detectCNLLocale } from './cnl-executor';

/**
 * runner 版本——进 reportHash，保证报告可复算归因到 runner 逻辑版本。
 * m1.1（本 PR，CCO 深审加固第一批）：P0-1 toolchain 强制 / P0-2 禁降阈值 / P0-3 筛回放态 /
 * P0-5 reportHash 补全+稳定序+版本分派 / P0-6 run 重算 caseHash+未知版本 fail-closed。
 * ★P0-4（受控接受 artifact）+ P0-7（DB append-only）留第二个 PR，**尚未实现**（勿据本注释误判口径）。
 * 逻辑变更必须 bump（旧版报告 hash 与新版按各自 runnerVersion 分派公式，不混算）。
 */
export const RULE_REGRESSION_RUNNER_VERSION = 'p0a-runner/m1.1';

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
  // P0-1：基线/当前工具链（进 reportHash + 报告审计——证明跨升级对比）。
  baselineToolchainId?: string;
  currentToolchainId?: string;
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
 * caseHash 公式版本。逻辑变更必须 bump——case 存 caseHashVersion，run 重算校验时按 case 自己
 * 的版本选公式（新旧共存），避免改公式让已冻结 m1 case 整批 GOLDEN_INTEGRITY_FAILURE。
 * - m1.0：原始 9 字段（policyVersionRow/function/locale/canonicalInput/expectedOutput/
 *   canonicalizationVersion/aliasSet/vocab/sourceKind）。
 * - m1.1：★CCO 复审 P0-6 补全——加绑 policyId/expectedDecision/coverageTags/
 *   baselineRuntimeToolchainId/sourceToolchainId/sourceEnvelopeSha256/sourceExecutionId，
 *   让篡改这些字段也被完整性校验捕获。
 */
export const CASE_HASH_VERSION_M10 = 'case-hash/m1.0';
export const CASE_HASH_VERSION = 'case-hash/m1.1';

export interface CaseHashFields {
  policyVersionRowId: string;
  functionName: string;
  locale: string;
  canonicalInputHash: string;
  expectedOutputHash: string;
  canonicalizationVersion: string;
  aliasSetJson: unknown;
  vocabSnapshotRef: unknown;
  sourceKind: string;
  // m1.1 新增绑定字段（防篡改覆盖）。
  policyId?: string;
  expectedDecision?: string | null;
  coverageTags?: string[];
  baselineRuntimeToolchainId?: string | null;
  sourceToolchainId?: string | null;
  sourceEnvelopeSha256?: string | null;
  sourceExecutionId?: string | null;
}

/**
 * caseHash = canonicalHash(核心不可变字段)——防篡改 + 去重锚。不含 createdAt/createdBy/id
 * （非决定性/身份字段）。按 {@param version} 选公式：m1.0=原 9 字段；m1.1=补全 7 字段。
 */
export function computeCaseHash(fields: CaseHashFields, version: string = CASE_HASH_VERSION): string {
  if (version === CASE_HASH_VERSION_M10) {
    // 旧公式：原样保留，供已冻结 m1.0 case 复算校验（不得改动，否则破坏历史证据）。
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
  // ★Codex 复审 P0-6：未知版本 fail-closed——不静默按 m1.1 算，否则 case-hash/corrupt 会被当合法。
  if (version !== CASE_HASH_VERSION) {
    throw new Error(`unsupported caseHashVersion: ${version}`);
  }
  // m1.1：全字段绑定。canonicalHash 内部对 object 键排序，字段顺序无关。
  return canonicalHash({
    version: CASE_HASH_VERSION,
    policyId: fields.policyId ?? null,
    policyVersionRowId: fields.policyVersionRowId,
    functionName: fields.functionName,
    locale: fields.locale,
    canonicalInputHash: fields.canonicalInputHash,
    expectedOutputHash: fields.expectedOutputHash,
    expectedDecision: fields.expectedDecision ?? null,
    canonicalizationVersion: fields.canonicalizationVersion,
    aliasSetJson: fields.aliasSetJson ?? {},
    vocabSnapshotRef: fields.vocabSnapshotRef ?? [],
    sourceKind: fields.sourceKind,
    coverageTags: (fields.coverageTags ?? []).slice().sort(),
    baselineRuntimeToolchainId: fields.baselineRuntimeToolchainId ?? null,
    sourceToolchainId: fields.sourceToolchainId ?? null,
    sourceEnvelopeSha256: fields.sourceEnvelopeSha256 ?? null,
    sourceExecutionId: fields.sourceExecutionId ?? null,
  });
}

/**
 * reportHash 公式版本（同 caseHash 版本化）。★Codex 复审 P0-5：**按报告自身的 runnerVersion 选公式**，
 * 不能用当前运行代码常量——否则拿 m1.0 历史 reportJson 在 m1.1 代码里复算会得到不同 hash（破坏历史可复算）。
 * m1.0=原公式（未含新逐 case 字段）；m1.1=补全字段+稳定序。未知版本 fail-closed（抛错，不静默按新公式）。
 */
const REPORT_HASH_VERSION_M10 = 'p0a-runner/m1.0';

/**
 * reportHash = canonicalHash(报告决定性内容)——报告防篡改 + 可复算。不含 reportId/createdAt（身份/时间）。
 * 按 {@code report.runnerVersion} 选公式（历史 artifact 用其自己冻结的版本复算）。
 */
export function computeReportHash(report: Omit<RunReport, 'reportId' | 'reportHash'>): string {
  if (report.runnerVersion === REPORT_HASH_VERSION_M10) {
    // m1.0 原公式：原样保留，供历史 m1.0 报告复算（不得改动）。
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
  if (report.runnerVersion !== RULE_REGRESSION_RUNNER_VERSION) {
    // 未知版本 fail-closed：不静默按新公式算，否则复算者拿到假的「可复算」hash。
    throw new Error(`unsupported reportHash runnerVersion: ${report.runnerVersion}`);
  }
  // m1.1：逐 case 补全（reason/decision/function/locale/sourceKind/coverageTags/toolchain 排序稳定），
  // 顶层补 baselineSemantics（报告对基线语义的声明也进 hash）。canonicalizationVersion 由每 case 的
  // caseHash 间接保护（caseHash 绑了它），且报告级 currentRuntimeToolchainId 已在。
  const cases = report.cases
    .slice()
    .sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0))
    .map((c) => ({
      caseId: c.caseId,
      status: c.status,
      reason: c.reason ?? null,
      expectedDecision: c.expectedDecision ?? null,
      functionName: c.functionName,
      locale: c.locale,
      sourceKind: c.sourceKind,
      coverageTags: (c.coverageTags ?? []).slice().sort(),
      expectedInputHash: c.expectedInputHash ?? null,
      actualInputHash: c.actualInputHash ?? null,
      expectedOutputHash: c.expectedOutputHash ?? null,
      actualOutputHash: c.actualOutputHash ?? null,
      baselineToolchainId: c.baselineToolchainId ?? null,
      currentToolchainId: c.currentToolchainId ?? null,
    }));
  return canonicalHash({
    reportHashVersion: report.runnerVersion,
    status: report.status,
    comparisonMode: report.comparisonMode,
    baselineSemantics: report.baselineSemantics,
    policyId: report.policyId,
    policyVersionRowId: report.policyVersionRowId,
    currentRuntimeToolchainId: report.currentRuntimeToolchainId,
    coverage: report.coverage,
    summary: report.summary,
    runnerVersion: report.runnerVersion,
    cases,
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
 * ★候选谓词筛 replayabilityStatus='REPLAYABLE' + traceHash + canonical hash + toolchain 齐全（PR1，P0-3）——
 * M2.1b 后 writer 对满足条件的行写 REPLAYABLE（见 buildReplayColumns），故这里能筛到真实可回放行。
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
      -- ★P0-3（CCO 复审）：只冻结宿主判定**可回放**的 execution。缺 traceHash / 缺基线工具链 /
      -- replayabilityStatus 非 REPLAYABLE 的行=宿主已判「无法逐字节复现当时决策」，把它们洗成
      -- runnable golden 会让报告假称「回放」。要求 REPLAYABLE + traceHash + baseline/source toolchain 齐全。
      -- （承 M2.1b：步骤级 trace + async→NON_REPLAYABLE 的宿主判定端到端接入冻结门。）
      AND e."replayabilityStatus" = 'REPLAYABLE'
      AND e."traceHash" IS NOT NULL
      AND e."runtimeToolchainId" IS NOT NULL
      AND e."sourceToolchainId" IS NOT NULL
    ORDER BY
      e."policyVersionRowId", e."functionName", e."locale", e."canonicalInputHash",
      e."createdAt" DESC
    LIMIT ${limit}
  `)) as unknown as Array<Record<string, unknown>>;

  const result: FreezeResult = { frozen: 0, duplicate: 0, skipped: 0, outputConflicts: [], caseIds: [], skippedReasons: [] };

  for (const c of candidates) {
    const caseHash = computeCaseHash({
      policyId: String(c.policyId),
      policyVersionRowId: String(c.policyVersionRowId),
      functionName: String(c.functionName),
      locale: String(c.locale),
      canonicalInputHash: String(c.canonicalInputHash),
      expectedOutputHash: String(c.expectedOutputHash),
      expectedDecision: c.expectedDecision == null ? null : String(c.expectedDecision),
      canonicalizationVersion: String(c.canonicalizationVersion),
      aliasSetJson: c.aliasSetJson,
      vocabSnapshotRef: c.vocabSnapshotRef,
      sourceKind: 'execution',
      coverageTags: [],
      baselineRuntimeToolchainId:
        c.baselineRuntimeToolchainId == null ? null : String(c.baselineRuntimeToolchainId),
      sourceToolchainId: c.sourceToolchainId == null ? null : String(c.sourceToolchainId),
      sourceEnvelopeSha256: c.sourceEnvelopeSha256 == null ? null : String(c.sourceEnvelopeSha256),
      sourceExecutionId: String(c.sourceExecutionId),
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
        caseHashVersion: CASE_HASH_VERSION,
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
  // ★P0-3（Codex 复审）：surface 宿主回放态——handwritten freeze 也据此 fail-closed（不冻不可回放）。
  replayabilityStatus: string | null;
  traceHash: string | null;
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
    replayabilityStatus: rm?.replayabilityStatus ?? null,
    traceHash: rm?.traceHash ?? null,
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
    // ★P0-3（Codex 复审）：handwritten 也 fail-closed——宿主判定不可回放（非 REPLAYABLE / 缺 traceHash /
    // 缺 runtimeToolchainId）的 evaluation 不冻结成 golden，否则与 execution 洗态同一漏洞（async/缺 trace
    // 的 handwritten 若后来 toolchain 不同就成 runnable case）。
    if (
      captured.replayabilityStatus !== 'REPLAYABLE' ||
      !captured.traceHash ||
      !captured.runtimeToolchainId
    ) {
      result.skipped++;
      result.skippedReasons.push(
        `not_replayable:${hc.functionName}:${captured.replayabilityStatus ?? 'unknown'}`
      );
      continue;
    }

    const caseHash = computeCaseHash({
      policyId,
      policyVersionRowId: pv.id,
      functionName: hc.functionName,
      locale,
      canonicalInputHash: captured.canonicalInputHash,
      expectedOutputHash: captured.canonicalOutputHash,
      expectedDecision: null,
      canonicalizationVersion: captured.canonicalizationVersion,
      aliasSetJson: aliasSet ?? {},
      vocabSnapshotRef: pv.vocabularySnapshotIds ?? [],
      sourceKind: 'handwritten',
      coverageTags: hc.coverageTags,
      baselineRuntimeToolchainId: captured.runtimeToolchainId,
      sourceToolchainId: pv.sourceToolchainId ?? null,
      sourceEnvelopeSha256: pv.sourceEnvelopeSha256 ?? null,
      sourceExecutionId: null,
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
        caseHashVersion: CASE_HASH_VERSION,
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
}): Promise<RunReport> {
  const { policyId, policyVersionRowId, actorUserId, tenantId } = params;
  // ★P0-2（CCO 复审）：签字模式覆盖门禁恒用 DEFAULT_THRESHOLDS，**不接受请求级下调**。
  // 若确需放宽须走独立 CCO approval artifact（另表，非临时降阈值）——否则同一 admin 既定阈值
  // 又跑又得 PASS，报告无法证明门禁未为本次升级临时放宽。
  const thresholds: CoverageThresholds = DEFAULT_THRESHOLDS;

  // 载入该版本的所有冻结 case。★P0-5（CCO 复审）：稳定 orderBy(id)——同一 case 集必须以固定
  // 顺序进 reportHash，否则返回序不同算出不同 hash，破坏「同内容可复算」。
  const cases = await db.query.regressionCases.findMany({
    where: and(
      eq(regressionCases.policyId, policyId),
      eq(regressionCases.policyVersionRowId, policyVersionRowId)
    ),
    orderBy: (t, { asc }) => [asc(t.id)],
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
  // 所有成功 capture 的 current toolchain（含 input-mismatch case）——用于 mixed 检测（不漏）。
  const capturedCurrentToolchains = new Set<string>();

  const aliasSet = pv ? parseAliasSet(pv.aliasSet) : null;

  for (const c of cases) {
    const base: CaseRunDetail = {
      caseId: c.id,
      status: 'NON_REPLAYABLE',
      expectedInputHash: c.canonicalInputHash,
      expectedOutputHash: c.expectedOutputHash,
      expectedDecision: c.expectedDecision,
      functionName: c.functionName,
      locale: c.locale,
      coverageTags: Array.isArray(c.coverageTags) ? (c.coverageTags as string[]) : [],
      sourceKind: c.sourceKind,
    };

    // ★P0-6（CCO 复审）：run 前重算 caseHash 并与存储值比对。expectedOutputHash/input/覆盖元数据
    // 被篡改后存储 hash 不再匹配 → 报证据损坏（GOLDEN_INTEGRITY_FAILURE），该 case 不参与业务判定
    // （标 FAIL_REGRESSION，不算 runnable-PASS——不可信 golden 不能证明无漂移）。按 case 自己的
    // caseHashVersion 选公式（新旧共存，见 CASE_HASH_VERSION）。
    // 未知 caseHashVersion → computeCaseHash 抛错（fail-closed）；这里捕获并标证据损坏，不崩整个 run。
    let recomputedCaseHash: string;
    try {
      recomputedCaseHash = computeCaseHash(
        {
          policyId: c.policyId,
          policyVersionRowId: c.policyVersionRowId,
          functionName: c.functionName,
          locale: c.locale,
          canonicalInputHash: c.canonicalInputHash,
          expectedOutputHash: c.expectedOutputHash,
          expectedDecision: c.expectedDecision,
          canonicalizationVersion: c.canonicalizationVersion,
          aliasSetJson: c.aliasSetJson,
          vocabSnapshotRef: c.vocabSnapshotRef,
          sourceKind: c.sourceKind,
          coverageTags: Array.isArray(c.coverageTags) ? (c.coverageTags as string[]) : [],
          baselineRuntimeToolchainId: c.baselineRuntimeToolchainId,
          sourceToolchainId: c.sourceToolchainId,
          sourceEnvelopeSha256: c.sourceEnvelopeSha256,
          sourceExecutionId: c.sourceExecutionId,
        },
        c.caseHashVersion
      );
    } catch {
      failed++;
      details.push({ ...base, status: 'FAIL_REGRESSION', reason: 'GOLDEN_INTEGRITY_FAILURE_UNKNOWN_VERSION' });
      continue;
    }
    if (recomputedCaseHash !== c.caseHash) {
      failed++;
      details.push({ ...base, status: 'FAIL_REGRESSION', reason: 'GOLDEN_INTEGRITY_FAILURE' });
      continue;
    }

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

    // ★P0-1（CCO 复审，最致命）：强制 baseline≠current toolchain。M1 FROZEN_BASELINE_VS_CURRENT_BACKEND
    // 的可信前提=冻结基线在**旧**工具链下捕获、run 在**新**工具链下回放。若团队升级**后**才 freeze，
    // 基线捕获的是新行为→新后端自比自己→假 PASS（报告没证明升级前后无漂移）。故：
    //   缺 baselineRuntimeToolchainId / 缺 current / 两者相同 → 该 case NON_REPLAYABLE（不算 runnable-PASS）。
    // 诚实标注：这些 case 无法证明「跨升级无漂移」，绝不能计入证明升级安全的 PASS 分母。
    if (
      !c.baselineRuntimeToolchainId ||
      !captured.runtimeToolchainId ||
      c.baselineRuntimeToolchainId === captured.runtimeToolchainId
    ) {
      nonReplayable++;
      const reason = !c.baselineRuntimeToolchainId
        ? 'MISSING_BASELINE_TOOLCHAIN'
        : !captured.runtimeToolchainId
          ? 'MISSING_CURRENT_TOOLCHAIN'
          : 'BASELINE_EQUALS_CURRENT_TOOLCHAIN';
      details.push({
        ...base,
        baselineToolchainId: c.baselineRuntimeToolchainId ?? undefined,
        currentToolchainId: captured.runtimeToolchainId ?? undefined,
        reason,
      });
      continue;
    }

    // ★到此 P0-1 已保证 baseline/current toolchain 齐全且不等。把它们写进**每个成功 capture 后的**
    // detail（PASS/FAIL/mismatch 全带，Codex 复审：否则新 reportHash 字段对有效 case 恒 null + mixed
    // 检测漏掉只出现在 input-mismatch case 的 toolchain）。记录本次 current toolchain 供 mixed 检测。
    const toolchainPair = {
      baselineToolchainId: c.baselineRuntimeToolchainId ?? undefined,
      currentToolchainId: captured.runtimeToolchainId ?? undefined,
    };
    capturedCurrentToolchains.add(captured.runtimeToolchainId);

    // 缺权威 output hash（后端未返回）→ 无法比对，不算通过。
    if (!captured.canonicalOutputHash) {
      nonReplayable++;
      details.push({ ...base, ...toolchainPair, reason: 'MISSING_ACTUAL_OUTPUT_HASH' });
      continue;
    }

    // ★校验 actual input hash（Codex 复审 #1）：证明回放的确是冻结时的同一 canonical input。
    // inputJson 被误写/篡改成另一输入时，即使 output hash 恰好相等也不能算通过——否则回放地基
    // 无法证明「跑的是 golden input」。缺/不等 → FAIL_REGRESSION（回放前提被破坏）。
    if (!captured.canonicalInputHash || captured.canonicalInputHash !== c.canonicalInputHash) {
      failed++;
      details.push({
        ...base,
        ...toolchainPair,
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
      details.push({
        ...base,
        ...toolchainPair,
        status: 'PASS',
        actualInputHash: captured.canonicalInputHash,
        actualOutputHash,
      });
    } else {
      failed++;
      details.push({
        ...base,
        ...toolchainPair,
        status: 'FAIL_REGRESSION',
        actualInputHash: captured.canonicalInputHash,
        actualOutputHash,
        reason: 'OUTPUT_HASH_MISMATCH',
      });
    }
  }

  // ★P0-1 补（Codex 复审 2）：混合 current toolchain 处理（纯函数，可单测）——只降 PASS，保留真实失败。
  const summary = applyMixedToolchainDowngrade(
    details,
    { passed, failed, nonReplayable, compileFailures },
    capturedCurrentToolchains
  );
  ({ passed, failed, nonReplayable, compileFailures } = summary);
  // 顶层 current toolchain：唯一则取该值，混合或无则 null（不取「最后一个」误导）。
  const currentRuntimeToolchainId =
    capturedCurrentToolchains.size === 1 ? [...capturedCurrentToolchains][0] : null;

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

export interface RunSummary {
  passed: number;
  failed: number;
  nonReplayable: number;
  compileFailures: number;
}

/**
 * 混合 current toolchain 降级（纯函数，可单测）。★Codex 复审 2：capturedCurrentToolchains 出现 >1 个
 * 不同 runtime toolchain 时，只把 **PASS** 降为 NON_REPLAYABLE（PASS 在混合后端下无法证明升级安全），
 * **保留** 所有 FAIL_REGRESSION（含 GOLDEN_INTEGRITY_FAILURE/EVALUATE_FAILED/INPUT_HASH_MISMATCH）与既有
 * NON_REPLAYABLE 原状态——真实失败/证据损坏是独立事实，不能被 mixed 洗白。原地改 details 状态，返回新计数。
 */
export function applyMixedToolchainDowngrade(
  details: CaseRunDetail[],
  summary: RunSummary,
  capturedCurrentToolchains: Set<string>
): RunSummary {
  if (capturedCurrentToolchains.size <= 1) return summary;
  let { passed } = summary;
  let { nonReplayable } = summary;
  for (const d of details) {
    if (d.status === 'PASS') {
      passed--;
      nonReplayable++;
      d.status = 'NON_REPLAYABLE';
      d.reason = 'MIXED_CURRENT_TOOLCHAIN';
    }
  }
  return { ...summary, passed, nonReplayable };
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

// ============ P0-4 受控接受漂移审批（ACCEPTED_DRIFT_WITH_APPROVAL）============
// 核心不变量：FAIL_REGRESSION 报告**永不**被改成 PASS。真实 bugfix 漂移由独立不可变审批 artifact
// 受控接受；有效状态由 report + 覆盖其全部 FAIL_REGRESSION drift 的有效审批 join **派生**。

/** 审批版本（进 approvalHash，逻辑变更 bump）。 */
export const DRIFT_APPROVAL_VERSION = 'p0a-drift-approval/m1.0';

/** 派生的有效状态：报告行 status 4 态 + 受控接受派生态。 */
export type EffectiveReportStatus = RegressionReportStatus | 'ACCEPTED_DRIFT_WITH_APPROVAL';

/** 一条被受控接受的 case 漂移（钉死 before/after output hash）。 */
export interface AcceptedDrift {
  caseId: string;
  /** 冻结基线的 expectedOutputHash（漂移前）。 */
  baselineOutputHash: string;
  /** 本次回放的 actualOutputHash（漂移后，已批范围）。升级后 case 输出须仍等于它。 */
  acceptedOutputHash: string;
}

/**
 * approvalHash = canonicalHash(审批决定性内容)——artifact 防篡改 + 可复算。
 * 覆盖 reportHash + acceptedDrifts(稳定序) + approver + reason + ticket + expiry + 版本。不含 id/createdAt。
 */
export function computeApprovalHash(fields: {
  reportHash: string;
  policyVersionRowId: string;
  acceptedDrifts: AcceptedDrift[];
  reason: string;
  ticketRef: string | null;
  approvedBy: string;
  expiresAt: string; // ISO
}): string {
  const drifts = fields.acceptedDrifts
    .slice()
    .sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0))
    .map((d) => ({
      caseId: d.caseId,
      baselineOutputHash: d.baselineOutputHash,
      acceptedOutputHash: d.acceptedOutputHash,
    }));
  return canonicalHash({
    approvalVersion: DRIFT_APPROVAL_VERSION,
    reportHash: fields.reportHash,
    policyVersionRowId: fields.policyVersionRowId,
    acceptedDrifts: drifts,
    reason: fields.reason,
    ticketRef: fields.ticketRef,
    approvedBy: fields.approvedBy,
    expiresAt: fields.expiresAt,
  });
}

export interface CreateApprovalResult {
  approvalId: string;
  approvalHash: string;
}

/**
 * 创建受控接受漂移审批（write 路径）。★职责分离：approvedBy **必须 != 报告 createdBy**（跨表 DB check
 * 做不到，应用层强制 + 审计）。★只接受**当前有效**报告：reportHash 必须匹配 DB 里的报告（防审批已被
 * 替换的旧报告）。★acceptedDrifts 必须精确覆盖报告全部 OUTPUT_HASH_MISMATCH drift（多/少/证据损坏 case
 * 都拒——不能审批不可接受的失败）。
 */
export async function createDriftApproval(params: {
  reportId: string;
  reason: string;
  ticketRef?: string | null;
  approvedBy: string;
  expiresAt: Date;
}): Promise<CreateApprovalResult> {
  const { reportId, reason, approvedBy, expiresAt } = params;
  const ticketRef = params.ticketRef ?? null;

  const report = (await db.query.regressionReports.findFirst({
    where: eq(regressionReports.id, reportId),
  })) as RegressionReport | undefined;
  if (!report) throw new Error('report_not_found');
  if (report.status !== 'FAIL_REGRESSION') {
    throw new Error(`report_not_failing:${report.status}`); // 只失败报告才需受控接受。
  }
  // ★职责分离：审批人不能是报告创建者。
  if (report.createdBy === approvedBy) {
    throw new Error('separation_of_duties:approver_equals_report_creator');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error('invalid_expiry:not_in_future');
  }

  const runReport = report.reportJson as unknown as RunReport;
  const failCases = runReport.cases.filter((c) => c.status === 'FAIL_REGRESSION');
  const approvable = extractApprovableDrifts(runReport);
  // 报告有不可受控接受的失败（证据损坏/回放破坏/编译失败）→ 整份不可审批。
  if (approvable.length !== failCases.length || approvable.length === 0) {
    throw new Error('report_has_unapprovable_failures');
  }

  const approvalHash = computeApprovalHash({
    reportHash: report.reportHash,
    policyVersionRowId: report.policyVersionRowId,
    acceptedDrifts: approvable,
    reason,
    ticketRef,
    approvedBy,
    expiresAt: expiresAt.toISOString(),
  });

  const approvalId = crypto.randomUUID();
  await db.insert(regressionDriftApprovals).values({
    id: approvalId,
    reportId,
    reportHash: report.reportHash,
    policyId: report.policyId,
    policyVersionRowId: report.policyVersionRowId,
    acceptedDrifts: approvable,
    reason,
    ticketRef,
    approvedBy,
    expiresAt,
    approvalHash,
  });
  return { approvalId, approvalHash };
}

/**
 * 查报告 + 其有效审批 → 派生有效状态（读路径）。
 */
export async function getEffectiveStatus(reportId: string, now: Date = new Date()): Promise<{
  report: RegressionReport;
  effectiveStatus: EffectiveReportStatus;
} | null> {
  const report = (await db.query.regressionReports.findFirst({
    where: eq(regressionReports.id, reportId),
  })) as RegressionReport | undefined;
  if (!report) return null;
  const approvals = await db.query.regressionDriftApprovals.findMany({
    where: and(eq(regressionDriftApprovals.reportId, reportId), isNull(regressionDriftApprovals.revokedAt)),
  });
  const runReport = report.reportJson as unknown as RunReport;
  const effectiveStatus = computeEffectiveStatus(
    {
      status: report.status as RegressionReportStatus,
      reportHash: report.reportHash,
      policyVersionRowId: report.policyVersionRowId,
      cases: runReport.cases,
    },
    approvals,
    now
  );
  return { report, effectiveStatus };
}

/**
 * 从 report 的 FAIL_REGRESSION case 抽取 drift 明细（caseId + baseline/actual output hash）。
 * 只 OUTPUT_HASH_MISMATCH 是「有意 bugfix 可受控接受」的漂移；GOLDEN_INTEGRITY_FAILURE / EVALUATE_FAILED /
 * INPUT_HASH_MISMATCH 是证据损坏/回放破坏，**不可**受控接受（不返回，审批无法覆盖它们）。
 */
export function extractApprovableDrifts(report: Pick<RunReport, 'cases'>): AcceptedDrift[] {
  return report.cases
    .filter((c) => c.status === 'FAIL_REGRESSION' && c.reason === 'OUTPUT_HASH_MISMATCH')
    .filter((c) => c.expectedOutputHash != null && c.actualOutputHash != null)
    .map((c) => ({
      caseId: c.caseId,
      baselineOutputHash: c.expectedOutputHash as string,
      acceptedOutputHash: c.actualOutputHash as string,
    }));
}

/**
 * 计算报告**有效状态**（纯函数，可单测）。核心：不改任何行，join report + 有效审批派生。
 *
 * FAIL_REGRESSION → ACCEPTED_DRIFT_WITH_APPROVAL 的条件（全满足）：
 *   1. 报告行 status === 'FAIL_REGRESSION'；
 *   2. 报告全部 FAIL_REGRESSION case **都是可受控接受的漂移**（OUTPUT_HASH_MISMATCH，无证据损坏/回放破坏）；
 *   3. 存在**单条**有效审批（未撤销、未过期、reportHash 匹配、**approvalHash 重算一致**）其 acceptedDrifts
 *      **精确等于**报告全部 approvable drift（不多不少、caseId+before/after hash 一致）。
 * ★Codex 复审 2：不 union 多条部分审批（否则两条各覆盖一半也算通过，放大脏数据影响）；且**重算 approvalHash**
 * 校验（否则直插一条伪造 approvalHash 的审批也能派生 ACCEPTED——artifact 防篡改必须在读路径闭环）。
 * 任一不满足 → 保持原 FAIL_REGRESSION（诚实，不假装受控接受）。
 * 其它状态（PASS/FAIL_INSUFFICIENT_COVERAGE/NON_REPLAYABLE）原样返回（不适用受控接受）。
 */
export function computeEffectiveStatus(
  report: Pick<RunReport, 'status' | 'reportHash' | 'policyVersionRowId' | 'cases'>,
  approvals: Array<
    Pick<
      RegressionDriftApproval,
      | 'reportHash'
      | 'policyVersionRowId'
      | 'acceptedDrifts'
      | 'reason'
      | 'ticketRef'
      | 'approvedBy'
      | 'expiresAt'
      | 'revokedAt'
      | 'approvalHash'
    >
  >,
  now: Date
): EffectiveReportStatus {
  if (report.status !== 'FAIL_REGRESSION') return report.status;

  // 报告的全部 FAIL_REGRESSION case。
  const failCases = report.cases.filter((c) => c.status === 'FAIL_REGRESSION');
  const approvable = extractApprovableDrifts(report);
  // 若有任何 FAIL case **不是**可受控接受的漂移（证据损坏/回放破坏）→ 不可受控接受。
  if (approvable.length !== failCases.length) return 'FAIL_REGRESSION';
  if (approvable.length === 0) return 'FAIL_REGRESSION';

  // 期望 drift 集（稳定序，供精确相等比较）。
  const expected = approvable
    .slice()
    .sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  const expectedKey = JSON.stringify(
    expected.map((d) => [d.caseId, d.baselineOutputHash, d.acceptedOutputHash])
  );

  for (const a of approvals) {
    if (a.revokedAt != null) continue;
    if (a.expiresAt.getTime() <= now.getTime()) continue;
    if (a.reportHash !== report.reportHash) continue;
    if (a.policyVersionRowId !== report.policyVersionRowId) continue;

    const drifts = (a.acceptedDrifts as AcceptedDrift[]) ?? [];
    // ★单条审批**精确等于**期望 drift 集（不 union）。
    const sorted = drifts
      .slice()
      .sort((x, y) => (x.caseId < y.caseId ? -1 : x.caseId > y.caseId ? 1 : 0));
    const key = JSON.stringify(
      sorted.map((d) => [d.caseId, d.baselineOutputHash, d.acceptedOutputHash])
    );
    if (key !== expectedKey) continue;

    // ★重算 approvalHash 校验（读路径闭环，防直插伪造）。
    const recomputed = computeApprovalHash({
      reportHash: a.reportHash,
      policyVersionRowId: a.policyVersionRowId,
      acceptedDrifts: drifts,
      reason: a.reason,
      ticketRef: a.ticketRef,
      approvedBy: a.approvedBy,
      expiresAt: a.expiresAt.toISOString(),
    });
    if (recomputed !== a.approvalHash) continue;

    return 'ACCEPTED_DRIFT_WITH_APPROVAL';
  }
  return 'FAIL_REGRESSION';
}

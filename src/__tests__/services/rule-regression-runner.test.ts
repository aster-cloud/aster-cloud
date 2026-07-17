import { describe, it, expect } from 'vitest';
import {
  assembleReport,
  applyMixedToolchainDowngrade,
  computeCaseHash,
  computeReportHash,
  computeApprovalHash,
  computeEffectiveStatus,
  extractApprovableDrifts,
  DEFAULT_THRESHOLDS,
  COMPARISON_MODE_FROZEN_BASELINE,
  CASE_HASH_VERSION,
  CASE_HASH_VERSION_M10,
  type CaseCoverageMeta,
  type CaseRunDetail,
  type CoverageThresholds,
  type AcceptedDrift,
} from '@/services/policy/rule-regression-runner';

/**
 * RuleRegressionRunner 纯决策核心单测（ADR 0030 附录 B.4）。
 *
 * assembleReport 是四态状态机的正确性心脏——覆盖门禁 + 状态优先级。抽出为纯函数使其可测而
 * 无需 mock DB/backend。铁律（防假通过）：
 *   NON_REPLAYABLE > FAIL_INSUFFICIENT_COVERAGE > FAIL_REGRESSION > PASS。
 *   即使全 match，覆盖不足也不 PASS。
 */

// 满足默认阈值的一组 case（4 runnable：2 approved + 2 denied，1 handwritten boundary）。
function coverageSatisfyingCases(): { cases: CaseCoverageMeta[]; details: CaseRunDetail[] } {
  const cases: CaseCoverageMeta[] = [
    { id: 'c1', expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] },
    { id: 'c2', expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] },
    { id: 'c3', expectedDecision: 'denied', sourceKind: 'execution', coverageTags: [] },
    { id: 'c4', expectedDecision: 'denied', sourceKind: 'handwritten', coverageTags: ['boundary'] },
  ];
  const details: CaseRunDetail[] = cases.map((c) => ({
    caseId: c.id,
    status: 'PASS',
    expectedOutputHash: 'h',
    actualOutputHash: 'h',
    functionName: 'f',
    locale: 'en-US',
    coverageTags: c.coverageTags,
    sourceKind: c.sourceKind,
  }));
  return { cases, details };
}

function summaryFrom(details: CaseRunDetail[]) {
  return {
    passed: details.filter((d) => d.status === 'PASS').length,
    failed: details.filter((d) => d.status === 'FAIL_REGRESSION').length,
    nonReplayable: details.filter((d) => d.status === 'NON_REPLAYABLE').length,
    compileFailures: 0,
  };
}

function assemble(cases: CaseCoverageMeta[], details: CaseRunDetail[], thresholds?: CoverageThresholds) {
  return assembleReport({
    policyId: 'p',
    policyVersionRowId: 'v',
    cases,
    details,
    summary: summaryFrom(details),
    currentRuntimeToolchainId: 'tc-1',
    thresholds: thresholds ?? DEFAULT_THRESHOLDS,
  });
}

describe('assembleReport — 四态状态机', () => {
  it('全 match + 覆盖达标 → PASS', () => {
    const { cases, details } = coverageSatisfyingCases();
    const r = assemble(cases, details);
    expect(r.status).toBe('PASS');
    expect(r.coverage.runnableCases).toBe(4);
    expect(r.coverage.unmet).toEqual([]);
    expect(r.comparisonMode).toBe(COMPARISON_MODE_FROZEN_BASELINE);
  });

  it('★覆盖不足 → FAIL_INSUFFICIENT_COVERAGE（即使全 match 也不 PASS）', () => {
    // 只 2 case（< minRunnable 4），全 PASS。
    const cases: CaseCoverageMeta[] = [
      { id: 'c1', expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] },
      { id: 'c2', expectedDecision: 'denied', sourceKind: 'execution', coverageTags: [] },
    ];
    const details: CaseRunDetail[] = cases.map((c) => ({
      caseId: c.id, status: 'PASS', functionName: 'f', locale: 'en-US',
      coverageTags: c.coverageTags, sourceKind: c.sourceKind, expectedOutputHash: 'h', actualOutputHash: 'h',
    }));
    const r = assemble(cases, details);
    expect(r.status).toBe('FAIL_INSUFFICIENT_COVERAGE');
    expect(r.coverage.unmet.some((u) => u.startsWith('runnable<'))).toBe(true);
    // 关键：全 match（0 failed）但覆盖不足仍不 PASS。
    expect(r.summary.failed).toBe(0);
  });

  it('缺 handwritten boundary → FAIL_INSUFFICIENT_COVERAGE', () => {
    const { cases, details } = coverageSatisfyingCases();
    // 去掉 boundary 标签。
    cases[3].coverageTags = [];
    cases[3].sourceKind = 'execution';
    details[3].coverageTags = [];
    details[3].sourceKind = 'execution';
    const r = assemble(cases, details);
    expect(r.status).toBe('FAIL_INSUFFICIENT_COVERAGE');
    expect(r.coverage.unmet.some((u) => u.startsWith('handwrittenBoundary<'))).toBe(true);
  });

  it('缺 approved 或 denied 决策 → FAIL_INSUFFICIENT_COVERAGE', () => {
    // 4 runnable 全 approved，无 denied。
    const cases: CaseCoverageMeta[] = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`, expectedDecision: 'approved', sourceKind: i === 0 ? 'handwritten' : 'execution',
      coverageTags: i === 0 ? ['boundary'] : [],
    }));
    const details: CaseRunDetail[] = cases.map((c) => ({
      caseId: c.id, status: 'PASS', functionName: 'f', locale: 'en-US',
      coverageTags: c.coverageTags, sourceKind: c.sourceKind, expectedOutputHash: 'h', actualOutputHash: 'h',
    }));
    const r = assemble(cases, details);
    expect(r.status).toBe('FAIL_INSUFFICIENT_COVERAGE');
    expect(r.coverage.unmet.some((u) => u.startsWith('denied<'))).toBe(true);
  });

  it('★hash mismatch → FAIL_REGRESSION（覆盖达标时）', () => {
    const { cases, details } = coverageSatisfyingCases();
    // c2 输出 hash 不匹配。
    details[1] = { ...details[1], status: 'FAIL_REGRESSION', actualOutputHash: 'DIFFERENT', reason: 'OUTPUT_HASH_MISMATCH' };
    const r = assemble(cases, details);
    expect(r.status).toBe('FAIL_REGRESSION');
    expect(r.summary.failed).toBe(1);
    expect(r.coverage.runnableCases).toBe(4); // FAIL_REGRESSION 也算 runnable。
  });

  it('★全 replay-limited（无 runnable）→ NON_REPLAYABLE', () => {
    const cases: CaseCoverageMeta[] = [
      { id: 'c1', expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] },
      { id: 'c2', expectedDecision: 'denied', sourceKind: 'execution', coverageTags: [] },
    ];
    const details: CaseRunDetail[] = cases.map((c) => ({
      caseId: c.id, status: 'NON_REPLAYABLE', functionName: 'f', locale: 'en-US',
      coverageTags: c.coverageTags, sourceKind: c.sourceKind, reason: 'REPLAY_LIMITED_NO_INPUT',
    }));
    const r = assemble(cases, details);
    expect(r.status).toBe('NON_REPLAYABLE');
    expect(r.coverage.runnableCases).toBe(0);
  });

  it('空 case 集 → NON_REPLAYABLE（冷启动不假通过）', () => {
    const r = assemble([], []);
    expect(r.status).toBe('NON_REPLAYABLE');
    expect(r.coverage.totalCases).toBe(0);
  });

  it('★状态优先级：覆盖不足 优先于 FAIL_REGRESSION', () => {
    // 只 2 runnable（覆盖不足），且其中 1 个 mismatch。覆盖门禁应先于 regression。
    const cases: CaseCoverageMeta[] = [
      { id: 'c1', expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] },
      { id: 'c2', expectedDecision: 'denied', sourceKind: 'execution', coverageTags: [] },
    ];
    const details: CaseRunDetail[] = [
      { caseId: 'c1', status: 'PASS', functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution', expectedOutputHash: 'h', actualOutputHash: 'h' },
      { caseId: 'c2', status: 'FAIL_REGRESSION', functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution', expectedOutputHash: 'h', actualOutputHash: 'X', reason: 'OUTPUT_HASH_MISMATCH' },
    ];
    const r = assemble(cases, details);
    // 覆盖不足优先（ADR 优先级：INSUFFICIENT_COVERAGE > FAIL_REGRESSION）。
    expect(r.status).toBe('FAIL_INSUFFICIENT_COVERAGE');
  });

  it('replay-limited case 不计入 runnable/覆盖（不静默算通过）', () => {
    const { cases, details } = coverageSatisfyingCases();
    // 把 c4（handwritten boundary denied）变 replay-limited。
    details[3] = { ...details[3], status: 'NON_REPLAYABLE', reason: 'REPLAY_LIMITED_NO_INPUT', actualOutputHash: undefined };
    const r = assemble(cases, details);
    expect(r.coverage.runnableCases).toBe(3); // c4 不算。
    expect(r.coverage.handwrittenBoundaryCases).toBe(0); // c4 不是 runnable，boundary 不算。
    // 缺 boundary → 覆盖不足。
    expect(r.status).toBe('FAIL_INSUFFICIENT_COVERAGE');
  });

  it('自定义 thresholds 覆盖默认', () => {
    const { cases, details } = coverageSatisfyingCases();
    const loose: CoverageThresholds = { minRunnableCases: 1, minApprovedCases: 1, minDeniedCases: 1, minHandwrittenBoundaryCases: 0 };
    const r = assemble(cases, details, loose);
    expect(r.status).toBe('PASS');
  });

  it('★INPUT_HASH_MISMATCH 计为 FAIL_REGRESSION（回放了错误输入=回放前提破坏）', () => {
    const { cases, details } = coverageSatisfyingCases();
    // c1 回放时 actual input hash 与冻结不符（inputJson 被篡改）→ FAIL_REGRESSION。
    details[0] = {
      ...details[0],
      status: 'FAIL_REGRESSION',
      expectedInputHash: 'ih1',
      actualInputHash: 'DIFFERENT_INPUT',
      reason: 'INPUT_HASH_MISMATCH',
    };
    const r = assemble(cases, details);
    expect(r.status).toBe('FAIL_REGRESSION');
    expect(r.summary.failed).toBeGreaterThanOrEqual(1);
    // INPUT_HASH_MISMATCH 的 case 仍算 runnable（参与 pass/fail）。
    expect(r.coverage.runnableCases).toBe(4);
  });
});

describe('computeCaseHash / computeReportHash — 防篡改 + 确定性', () => {
  const caseFields = {
    policyVersionRowId: 'v1',
    functionName: 'approveLoan',
    locale: 'en-US',
    canonicalInputHash: 'ih',
    expectedOutputHash: 'oh',
    canonicalizationVersion: 'aster-canonical-json/v1',
    aliasSetJson: {},
    vocabSnapshotRef: [],
    sourceKind: 'execution',
  };

  it('caseHash 确定性：同字段同 hash', () => {
    expect(computeCaseHash(caseFields)).toBe(computeCaseHash({ ...caseFields }));
  });

  it('caseHash 敏感：expectedOutputHash 变则 caseHash 变（防篡改）', () => {
    expect(computeCaseHash(caseFields)).not.toBe(computeCaseHash({ ...caseFields, expectedOutputHash: 'oh2' }));
  });

  it('caseHash 敏感：sourceKind 变则变（execution vs handwritten 不同 golden）', () => {
    expect(computeCaseHash(caseFields)).not.toBe(computeCaseHash({ ...caseFields, sourceKind: 'handwritten' }));
  });

  it('reportHash 确定性 + 敏感于 status', () => {
    const { cases, details } = coverageSatisfyingCases();
    const body = assemble(cases, details);
    const h1 = computeReportHash(body);
    const h2 = computeReportHash({ ...body });
    expect(h1).toBe(h2);
    // status 变 → hash 变。
    expect(h1).not.toBe(computeReportHash({ ...body, status: 'FAIL_REGRESSION' }));
  });

  it('reportHash 敏感于 case 实际 hash（漂移证据不可篡改）', () => {
    const { cases, details } = coverageSatisfyingCases();
    const body = assemble(cases, details);
    const tampered = { ...body, cases: body.cases.map((c, i) => (i === 0 ? { ...c, actualOutputHash: 'FORGED' } : c)) };
    expect(computeReportHash(body)).not.toBe(computeReportHash(tampered));
  });
});

// ============ CCO 复审加固（P0-1/2/3/5/6）新行为契约 ============
describe('caseHash 加固 — P0-6 补全字段（m1.1）', () => {
  const base = {
    policyId: 'p1',
    policyVersionRowId: 'v1',
    functionName: 'approveLoan',
    locale: 'en-US',
    canonicalInputHash: 'ih',
    expectedOutputHash: 'oh',
    expectedDecision: 'approved' as string | null,
    canonicalizationVersion: 'aster-canonical-json/v1',
    aliasSetJson: {},
    vocabSnapshotRef: [],
    sourceKind: 'execution',
    coverageTags: ['boundary'],
    baselineRuntimeToolchainId: 'tc-old',
    sourceToolchainId: 'src-1',
    sourceEnvelopeSha256: 'env-1',
    sourceExecutionId: 'exec-1',
  };

  it('m1.1 caseHash 敏感于新绑定字段（改任一 → hash 变 → 篡改被捕获）', () => {
    const h = computeCaseHash(base);
    // 每个 m1.1 新绑字段单独改，hash 必须变。
    expect(h).not.toBe(computeCaseHash({ ...base, policyId: 'p2' }));
    expect(h).not.toBe(computeCaseHash({ ...base, expectedDecision: 'denied' }));
    expect(h).not.toBe(computeCaseHash({ ...base, baselineRuntimeToolchainId: 'tc-new' }));
    expect(h).not.toBe(computeCaseHash({ ...base, sourceToolchainId: 'src-2' }));
    expect(h).not.toBe(computeCaseHash({ ...base, sourceEnvelopeSha256: 'env-2' }));
    expect(h).not.toBe(computeCaseHash({ ...base, sourceExecutionId: 'exec-2' }));
    expect(h).not.toBe(computeCaseHash({ ...base, coverageTags: ['reject'] }));
  });

  it('coverageTags 顺序无关（排序后进 hash）', () => {
    expect(computeCaseHash({ ...base, coverageTags: ['a', 'b'] })).toBe(
      computeCaseHash({ ...base, coverageTags: ['b', 'a'] })
    );
  });

  it('★新旧公式共存：m1.0 与 m1.1 对同字段算不同 hash（版本隔离，不混算）', () => {
    const m10 = computeCaseHash(base, CASE_HASH_VERSION_M10);
    const m11 = computeCaseHash(base, CASE_HASH_VERSION);
    expect(m10).not.toBe(m11);
    // m1.0 公式对新字段不敏感（只 9 字段）——改 policyId 不影响 m1.0 hash。
    expect(computeCaseHash(base, CASE_HASH_VERSION_M10)).toBe(
      computeCaseHash({ ...base, policyId: 'other' }, CASE_HASH_VERSION_M10)
    );
    // m1.1 对 policyId 敏感。
    expect(computeCaseHash(base, CASE_HASH_VERSION)).not.toBe(
      computeCaseHash({ ...base, policyId: 'other' }, CASE_HASH_VERSION)
    );
  });
});

describe('reportHash 加固 — P0-5 补全 + 稳定排序', () => {
  it('★case 顺序无关：同 case 集乱序算同 reportHash（可复算）', () => {
    const { cases, details } = coverageSatisfyingCases();
    const body = assemble(cases, details);
    const shuffled = { ...body, cases: body.cases.slice().reverse() };
    expect(computeReportHash(body)).toBe(computeReportHash(shuffled));
  });

  it('reportHash 敏感于 case reason（改 reason 不再保持同 hash）', () => {
    const { cases, details } = coverageSatisfyingCases();
    const body = assemble(cases, details);
    const tampered = { ...body, cases: body.cases.map((c, i) => (i === 0 ? { ...c, reason: 'FORGED_REASON' } : c)) };
    expect(computeReportHash(body)).not.toBe(computeReportHash(tampered));
  });

  it('reportHash 敏感于 baseline/current toolchain（改工具链归因不可篡改）', () => {
    const { cases, details } = coverageSatisfyingCases();
    const body = assemble(cases, details);
    const tampered = {
      ...body,
      cases: body.cases.map((c, i) => (i === 0 ? { ...c, baselineToolchainId: 'FORGED_TC' } : c)),
    };
    expect(computeReportHash(body)).not.toBe(computeReportHash(tampered));
  });

  it('★reportHash 按报告自身 runnerVersion 选公式（m1.0 报告用 m1.0 公式复算，不被 m1.1 代码改写）', () => {
    const { cases, details } = coverageSatisfyingCases();
    const m11 = assemble(cases, details); // runnerVersion=m1.1
    const m10 = { ...m11, runnerVersion: 'p0a-runner/m1.0' };
    // m1.0 与 m1.1 公式不同 → 同报告体不同 hash（版本分派生效）。
    expect(computeReportHash(m10)).not.toBe(computeReportHash(m11));
    // m1.0 复算确定性（历史报告可复算）。
    expect(computeReportHash(m10)).toBe(computeReportHash({ ...m10 }));
  });

  it('★未知 runnerVersion → fail-closed 抛错（不静默按新公式给假可复算 hash）', () => {
    const { cases, details } = coverageSatisfyingCases();
    const body = { ...assemble(cases, details), runnerVersion: 'p0a-runner/CORRUPT' };
    expect(() => computeReportHash(body)).toThrow(/unsupported reportHash runnerVersion/);
  });
});

describe('applyMixedToolchainDowngrade — 混合 toolchain 只降 PASS 不洗真实失败（P0-1 补，Codex 复审 2）', () => {
  const mk = (caseId: string, status: CaseRunDetail['status'], reason?: string): CaseRunDetail => ({
    caseId,
    status,
    functionName: 'f',
    locale: 'en-US',
    coverageTags: [],
    sourceKind: 'execution',
    reason,
  });

  it('单一 toolchain → 不变', () => {
    const details = [mk('a', 'PASS')];
    const s = applyMixedToolchainDowngrade(details, { passed: 1, failed: 0, nonReplayable: 0, compileFailures: 0 }, new Set(['tc-1']));
    expect(details[0].status).toBe('PASS');
    expect(s).toEqual({ passed: 1, failed: 0, nonReplayable: 0, compileFailures: 0 });
  });

  it('混合 toolchain：两 PASS 全降 NON_REPLAYABLE（passed→0, nonReplayable+2）', () => {
    const details = [mk('a', 'PASS'), mk('b', 'PASS')];
    const s = applyMixedToolchainDowngrade(details, { passed: 2, failed: 0, nonReplayable: 0, compileFailures: 0 }, new Set(['tc-1', 'tc-2']));
    expect(details.every((d) => d.status === 'NON_REPLAYABLE' && d.reason === 'MIXED_CURRENT_TOOLCHAIN')).toBe(true);
    expect(s).toEqual({ passed: 0, failed: 0, nonReplayable: 2, compileFailures: 0 });
  });

  it('★混合 toolchain 不洗 OUTPUT_HASH_MISMATCH（真实回归保留）', () => {
    const details = [mk('a', 'PASS'), mk('b', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH')];
    const s = applyMixedToolchainDowngrade(details, { passed: 1, failed: 1, nonReplayable: 0, compileFailures: 0 }, new Set(['tc-1', 'tc-2']));
    expect(details[0].status).toBe('NON_REPLAYABLE'); // PASS 降级
    expect(details[1].status).toBe('FAIL_REGRESSION'); // 回归保留
    expect(details[1].reason).toBe('OUTPUT_HASH_MISMATCH');
    expect(s).toEqual({ passed: 0, failed: 1, nonReplayable: 1, compileFailures: 0 });
  });

  it('★混合 toolchain 不洗 GOLDEN_INTEGRITY_FAILURE（证据损坏保留）', () => {
    const details = [mk('a', 'PASS'), mk('b', 'FAIL_REGRESSION', 'GOLDEN_INTEGRITY_FAILURE')];
    const s = applyMixedToolchainDowngrade(details, { passed: 1, failed: 1, nonReplayable: 0, compileFailures: 0 }, new Set(['tc-1', 'tc-2']));
    expect(details[1].status).toBe('FAIL_REGRESSION');
    expect(details[1].reason).toBe('GOLDEN_INTEGRITY_FAILURE');
    expect(s.failed).toBe(1);
  });

  it('★混合 toolchain 不洗 EVALUATE_FAILED（compileFailures 与 failed 不矛盾）', () => {
    const details = [mk('a', 'PASS'), mk('b', 'FAIL_REGRESSION', 'EVALUATE_FAILED:boom')];
    const s = applyMixedToolchainDowngrade(details, { passed: 1, failed: 1, nonReplayable: 0, compileFailures: 1 }, new Set(['tc-1', 'tc-2']));
    // compileFailures 保持 1，failed 保持 1（对应的 EVALUATE_FAILED 未被洗）——不出现 failed<compileFailures 矛盾。
    expect(s.failed).toBe(1);
    expect(s.compileFailures).toBe(1);
    expect(details[1].status).toBe('FAIL_REGRESSION');
  });

  it('计数守恒：passed+failed+nonReplayable 总数不变', () => {
    const details = [mk('a', 'PASS'), mk('b', 'PASS'), mk('c', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH')];
    const before = { passed: 2, failed: 1, nonReplayable: 0, compileFailures: 0 };
    const s = applyMixedToolchainDowngrade(details, before, new Set(['tc-1', 'tc-2']));
    expect(s.passed + s.failed + s.nonReplayable).toBe(before.passed + before.failed + before.nonReplayable);
  });
});

describe('caseHash 未知版本 fail-closed — P0-6', () => {
  const base = {
    policyId: 'p1',
    policyVersionRowId: 'v1',
    functionName: 'f',
    locale: 'en-US',
    canonicalInputHash: 'ih',
    expectedOutputHash: 'oh',
    canonicalizationVersion: 'aster-canonical-json/v1',
    aliasSetJson: {},
    vocabSnapshotRef: [],
    sourceKind: 'execution',
  };
  it('未知 caseHashVersion → 抛错（不静默按 m1.1）', () => {
    expect(() => computeCaseHash(base, 'case-hash/CORRUPT')).toThrow(/unsupported caseHashVersion/);
  });
  it('已知版本 m1.0/m1.1 不抛', () => {
    expect(() => computeCaseHash(base, CASE_HASH_VERSION_M10)).not.toThrow();
    expect(() => computeCaseHash(base, CASE_HASH_VERSION)).not.toThrow();
  });
});

// ============ P0-4 受控接受漂移审批 ============
describe('computeEffectiveStatus — 受控接受派生态（不改任何行）', () => {
  const mkCase = (caseId: string, status: CaseRunDetail['status'], reason?: string, eh?: string, ah?: string): CaseRunDetail => ({
    caseId,
    status,
    reason,
    expectedOutputHash: eh,
    actualOutputHash: ah,
    functionName: 'f',
    locale: 'en-US',
    coverageTags: [],
    sourceKind: 'execution',
  });
  const future = new Date(Date.now() + 86400_000);
  const past = new Date(Date.now() - 86400_000);
  const now = new Date();
  const PVR = 'v1';

  // 构造一条**有效**审批（approvalHash 由 computeApprovalHash 真算，读路径会重算校验）。
  const validApproval = (opts: {
    reportHash: string;
    policyVersionRowId?: string;
    drifts: AcceptedDrift[];
    revokedAt?: Date | null;
    expiresAt?: Date;
    reason?: string;
    ticketRef?: string | null;
    approvedBy?: string;
  }) => {
    const policyVersionRowId = opts.policyVersionRowId ?? PVR;
    const reason = opts.reason ?? 'bugfix';
    const ticketRef = opts.ticketRef ?? null;
    const approvedBy = opts.approvedBy ?? 'user-b';
    const expiresAt = opts.expiresAt ?? future;
    return {
      reportHash: opts.reportHash,
      policyVersionRowId,
      acceptedDrifts: opts.drifts,
      reason,
      ticketRef,
      approvedBy,
      expiresAt,
      revokedAt: opts.revokedAt ?? null,
      approvalHash: computeApprovalHash({
        reportHash: opts.reportHash,
        policyVersionRowId,
        acceptedDrifts: opts.drifts,
        reason,
        ticketRef,
        approvedBy,
        expiresAt: expiresAt.toISOString(),
      }),
    };
  };
  const rpt = (reportHash: string, cases: CaseRunDetail[]) => ({
    status: 'FAIL_REGRESSION' as const,
    reportHash,
    policyVersionRowId: PVR,
    cases,
  });

  it('非 FAIL_REGRESSION 报告原样返回（PASS/覆盖不足/NON_REPLAYABLE 不适用受控接受）', () => {
    for (const s of ['PASS', 'FAIL_INSUFFICIENT_COVERAGE', 'NON_REPLAYABLE'] as const) {
      expect(computeEffectiveStatus({ status: s, reportHash: 'rh', policyVersionRowId: PVR, cases: [] }, [], now)).toBe(s);
    }
  });

  it('★有效审批精确覆盖全部 OUTPUT_HASH_MISMATCH → ACCEPTED_DRIFT_WITH_APPROVAL', () => {
    const report = rpt('rh', [mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'base1', 'new1')]);
    const approvals = [validApproval({ reportHash: 'rh', drifts: [{ caseId: 'c1', baselineOutputHash: 'base1', acceptedOutputHash: 'new1' }] })];
    expect(computeEffectiveStatus(report, approvals, now)).toBe('ACCEPTED_DRIFT_WITH_APPROVAL');
  });

  it('★无审批 → FAIL_REGRESSION', () => {
    const report = rpt('rh', [mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'base1', 'new1')]);
    expect(computeEffectiveStatus(report, [], now)).toBe('FAIL_REGRESSION');
  });

  it('★approvalHash 被篡改（直插伪造）→ FAIL_REGRESSION（读路径重算校验）', () => {
    const report = rpt('rh', [mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'base1', 'new1')]);
    const a = validApproval({ reportHash: 'rh', drifts: [{ caseId: 'c1', baselineOutputHash: 'base1', acceptedOutputHash: 'new1' }] });
    const forged = { ...a, approvalHash: 'FORGED_HASH' };
    expect(computeEffectiveStatus(report, [forged], now)).toBe('FAIL_REGRESSION');
  });

  it('★审批 reportHash 不匹配当前报告 → FAIL_REGRESSION', () => {
    const report = rpt('rh-NEW', [mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'base1', 'new1')]);
    const approvals = [validApproval({ reportHash: 'rh-OLD', drifts: [{ caseId: 'c1', baselineOutputHash: 'base1', acceptedOutputHash: 'new1' }] })];
    expect(computeEffectiveStatus(report, approvals, now)).toBe('FAIL_REGRESSION');
  });

  it('★已撤销审批 → FAIL_REGRESSION', () => {
    const report = rpt('rh', [mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'base1', 'new1')]);
    const approvals = [validApproval({ reportHash: 'rh', drifts: [{ caseId: 'c1', baselineOutputHash: 'base1', acceptedOutputHash: 'new1' }], revokedAt: past })];
    expect(computeEffectiveStatus(report, approvals, now)).toBe('FAIL_REGRESSION');
  });

  it('★已过期审批 → FAIL_REGRESSION（防一次审批永久放行）', () => {
    const report = rpt('rh', [mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'base1', 'new1')]);
    const approvals = [validApproval({ reportHash: 'rh', drifts: [{ caseId: 'c1', baselineOutputHash: 'base1', acceptedOutputHash: 'new1' }], expiresAt: past })];
    expect(computeEffectiveStatus(report, approvals, now)).toBe('FAIL_REGRESSION');
  });

  it('★acceptedOutputHash 与当前 drift 不符（升级后输出又变，超出已批范围）→ FAIL_REGRESSION', () => {
    const report = rpt('rh', [mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'base1', 'new2')]);
    const approvals = [validApproval({ reportHash: 'rh', drifts: [{ caseId: 'c1', baselineOutputHash: 'base1', acceptedOutputHash: 'new1' }] })];
    expect(computeEffectiveStatus(report, approvals, now)).toBe('FAIL_REGRESSION');
  });

  it('★报告含不可受控接受的失败（GOLDEN_INTEGRITY_FAILURE）→ FAIL_REGRESSION', () => {
    const report = rpt('rh', [
      mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'base1', 'new1'),
      mkCase('c2', 'FAIL_REGRESSION', 'GOLDEN_INTEGRITY_FAILURE'),
    ]);
    const approvals = [validApproval({ reportHash: 'rh', drifts: [{ caseId: 'c1', baselineOutputHash: 'base1', acceptedOutputHash: 'new1' }] })];
    expect(computeEffectiveStatus(report, approvals, now)).toBe('FAIL_REGRESSION');
  });

  it('★单条审批部分覆盖（两 drift 只批一个）→ FAIL_REGRESSION（必须精确全覆盖）', () => {
    const report = rpt('rh', [
      mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'b1', 'n1'),
      mkCase('c2', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'b2', 'n2'),
    ]);
    const approvals = [validApproval({ reportHash: 'rh', drifts: [{ caseId: 'c1', baselineOutputHash: 'b1', acceptedOutputHash: 'n1' }] })];
    expect(computeEffectiveStatus(report, approvals, now)).toBe('FAIL_REGRESSION');
  });

  it('★两条各覆盖一半的审批 union → 仍 FAIL_REGRESSION（不 union，须单条精确覆盖，Codex 复审 2）', () => {
    const report = rpt('rh', [
      mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'b1', 'n1'),
      mkCase('c2', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'b2', 'n2'),
    ]);
    const a1 = validApproval({ reportHash: 'rh', approvedBy: 'user-b', drifts: [{ caseId: 'c1', baselineOutputHash: 'b1', acceptedOutputHash: 'n1' }] });
    const a2 = validApproval({ reportHash: 'rh', approvedBy: 'user-c', drifts: [{ caseId: 'c2', baselineOutputHash: 'b2', acceptedOutputHash: 'n2' }] });
    expect(computeEffectiveStatus(report, [a1, a2], now)).toBe('FAIL_REGRESSION');
  });

  it('★审批含额外 drift（超出报告）→ FAIL_REGRESSION（不多不少）', () => {
    const report = rpt('rh', [mkCase('c1', 'FAIL_REGRESSION', 'OUTPUT_HASH_MISMATCH', 'b1', 'n1')]);
    const approvals = [validApproval({ reportHash: 'rh', drifts: [
      { caseId: 'c1', baselineOutputHash: 'b1', acceptedOutputHash: 'n1' },
      { caseId: 'cX', baselineOutputHash: 'bX', acceptedOutputHash: 'nX' },
    ] })];
    expect(computeEffectiveStatus(report, approvals, now)).toBe('FAIL_REGRESSION');
  });
});
describe('extractApprovableDrifts / computeApprovalHash', () => {
  it('只抽 OUTPUT_HASH_MISMATCH（证据损坏/编译失败不可受控接受）', () => {
    const cases: CaseRunDetail[] = [
      { caseId: 'c1', status: 'FAIL_REGRESSION', reason: 'OUTPUT_HASH_MISMATCH', expectedOutputHash: 'b1', actualOutputHash: 'n1', functionName: 'f', locale: 'l', coverageTags: [], sourceKind: 'execution' },
      { caseId: 'c2', status: 'FAIL_REGRESSION', reason: 'GOLDEN_INTEGRITY_FAILURE', functionName: 'f', locale: 'l', coverageTags: [], sourceKind: 'execution' },
      { caseId: 'c3', status: 'PASS', functionName: 'f', locale: 'l', coverageTags: [], sourceKind: 'execution' },
    ];
    const drifts = extractApprovableDrifts({ cases });
    expect(drifts).toEqual([{ caseId: 'c1', baselineOutputHash: 'b1', acceptedOutputHash: 'n1' }]);
  });

  it('approvalHash 确定性 + 敏感于关键字段', () => {
    const f = { reportHash: 'rh', policyVersionRowId: 'v1', acceptedDrifts: [{ caseId: 'c1', baselineOutputHash: 'b1', acceptedOutputHash: 'n1' }], reason: 'bugfix', ticketRef: 'T-1', approvedBy: 'user-b', expiresAt: '2026-01-01T00:00:00.000Z' };
    expect(computeApprovalHash(f)).toBe(computeApprovalHash({ ...f }));
    expect(computeApprovalHash(f)).not.toBe(computeApprovalHash({ ...f, approvedBy: 'user-c' }));
    expect(computeApprovalHash(f)).not.toBe(computeApprovalHash({ ...f, reason: 'other' }));
    expect(computeApprovalHash(f)).not.toBe(computeApprovalHash({ ...f, expiresAt: '2027-01-01T00:00:00.000Z' }));
    // drift 顺序无关（排序进 hash）。
    const two = [{ caseId: 'a', baselineOutputHash: 'b', acceptedOutputHash: 'c' }, { caseId: 'z', baselineOutputHash: 'y', acceptedOutputHash: 'x' }];
    expect(computeApprovalHash({ ...f, acceptedDrifts: two })).toBe(computeApprovalHash({ ...f, acceptedDrifts: two.slice().reverse() }));
  });
});

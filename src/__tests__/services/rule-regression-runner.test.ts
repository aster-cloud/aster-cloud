import { describe, it, expect } from 'vitest';
import {
  assembleReport,
  applyMixedToolchainDowngrade,
  computeCaseHash,
  computeReportHash,
  computeApprovalHash,
  computeEffectiveStatus,
  extractApprovableDrifts,
  verifyReportIntegrity,
  deriveReportSignability,
  deriveReportSignabilityDetail as _drsd,
  isSignablePass,
  isDriftApprovable,
  type UnsignableReason as _UR,
  DEFAULT_THRESHOLDS,
  COMPARISON_MODE_FROZEN_BASELINE,
  CASE_HASH_VERSION,
  CASE_HASH_VERSION_M10,
  type CaseCoverageMeta,
  type CaseRunDetail,
  type CoverageThresholds,
  type AcceptedDrift,
  type GoldenCaseSnapshot,
  type RunReport,
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
    caseHash: `${c.id}-hash`,
    caseHashVersion: CASE_HASH_VERSION,
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
      caseId: c.id, status: 'PASS', caseHash: `${c.id}-hash`, caseHashVersion: CASE_HASH_VERSION,
      functionName: 'f', locale: 'en-US',
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
      caseId: c.id, status: 'PASS', caseHash: `${c.id}-hash`, caseHashVersion: CASE_HASH_VERSION,
      functionName: 'f', locale: 'en-US',
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
      caseId: c.id, status: 'NON_REPLAYABLE', caseHash: `${c.id}-hash`, caseHashVersion: CASE_HASH_VERSION,
      functionName: 'f', locale: 'en-US',
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
      { caseId: 'c1', status: 'PASS', caseHash: 'c1-hash', caseHashVersion: CASE_HASH_VERSION, functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution', expectedOutputHash: 'h', actualOutputHash: 'h' },
      { caseId: 'c2', status: 'FAIL_REGRESSION', caseHash: 'c2-hash', caseHashVersion: CASE_HASH_VERSION, functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution', expectedOutputHash: 'h', actualOutputHash: 'X', reason: 'OUTPUT_HASH_MISMATCH' },
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
    caseHash: `${caseId}-hash`,
    caseHashVersion: CASE_HASH_VERSION,
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
    caseHash: `${caseId}-hash`,
    caseHashVersion: CASE_HASH_VERSION,
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
    // ★Item 2：默认 m1.3 可签字报告（cases 全 m1.1 → signability SIGNABLE + count 0，与 deriveReportSignability
    // 自洽性校验一致）。
    runnerVersion: 'p0a-runner/m1.3' as const,
    signability: 'SIGNABLE' as const,
    unsignableLegacyCases: 0,
  });

  it('非 FAIL_REGRESSION 报告原样返回（PASS/覆盖不足/NON_REPLAYABLE 不适用受控接受）', () => {
    for (const s of ['PASS', 'FAIL_INSUFFICIENT_COVERAGE', 'NON_REPLAYABLE'] as const) {
      expect(computeEffectiveStatus({ status: s, reportHash: 'rh', policyVersionRowId: PVR, cases: [], runnerVersion: 'p0a-runner/m1.3', signability: 'SIGNABLE', unsignableLegacyCases: 0 }, [], now)).toBe(s);
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
      { caseId: 'c1', status: 'FAIL_REGRESSION', caseHash: 'c1-hash', caseHashVersion: CASE_HASH_VERSION, reason: 'OUTPUT_HASH_MISMATCH', expectedOutputHash: 'b1', actualOutputHash: 'n1', functionName: 'f', locale: 'l', coverageTags: [], sourceKind: 'execution' },
      { caseId: 'c2', status: 'FAIL_REGRESSION', caseHash: 'c2-hash', caseHashVersion: CASE_HASH_VERSION, reason: 'GOLDEN_INTEGRITY_FAILURE', functionName: 'f', locale: 'l', coverageTags: [], sourceKind: 'execution' },
      { caseId: 'c3', status: 'PASS', caseHash: 'c3-hash', caseHashVersion: CASE_HASH_VERSION, functionName: 'f', locale: 'l', coverageTags: [], sourceKind: 'execution' },
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

// ============ m1.2：reportHash 绑 caseHash + 离线核验协议（签字级） ============

/** 固定报告体（决定性）——golden hash vector 的输入。改公式即会让下方硬编码向量失配（历史不破守卫）。 */
function fixedReportBody(runnerVersion: string): Omit<RunReport, 'reportId' | 'reportHash'> {
  const cases: CaseRunDetail[] = [
    {
      caseId: 'c1', status: 'PASS', caseHash: 'CASEHASH-1', caseHashVersion: 'case-hash/m1.1',
      functionName: 'greet', locale: 'en-US', coverageTags: ['boundary'], sourceKind: 'execution',
      expectedInputHash: 'ei1', actualInputHash: 'ai1', expectedOutputHash: 'eo1', actualOutputHash: 'ao1',
      baselineToolchainId: 'tc-base', currentToolchainId: 'tc-cur',
    },
  ];
  return {
    status: 'PASS', comparisonMode: 'FROZEN_BASELINE_VS_CURRENT_BACKEND',
    baselineSemantics: 'sem', policyId: 'pol-1', policyVersionRowId: 'pv-1',
    currentRuntimeToolchainId: 'tc-cur',
    coverage: {
      totalCases: 1, runnableCases: 1, approvedCases: 1, deniedCases: 0, handwrittenBoundaryCases: 1,
      thresholds: { minRunnableCases: 1, minApprovedCases: 1, minDeniedCases: 0, minHandwrittenBoundaryCases: 1 },
      unmet: [],
    },
    summary: { passed: 1, failed: 0, nonReplayable: 0, compileFailures: 0 },
    cases, runnerVersion,
    // signability/unsignableLegacyCases 只进 m1.3 hash；m1.0/m1.1/m1.2 公式忽略它们（向量不受影响）。
    signability: 'SIGNABLE',
    unsignableLegacyCases: 0,
  };
}

describe('reportHash m1.2 — 绑 caseHash + 版本分派 + 历史向量冻结', () => {
  // ★硬编码 golden vector（非同实现自算两次）：改动 m1.0/m1.1/m1.2 任一公式都会让对应向量失配。
  // m1.0/m1.1 向量是历史不破守卫；m1.2 向量锁定新公式。
  const VECTORS: Record<string, string> = {
    'p0a-runner/m1.0': '357106de681456ad305f7a4e0c4d147adc1ddd10af04676b0499387f5f138177',
    'p0a-runner/m1.1': '5b1a923ba14421233489b31344efebadfd634b25875cb1c373e7ab7b59379381',
    'p0a-runner/m1.2': '00f72de53953e918eb6624d8dfeefaf89cc5bc6b2fa362e5c134c011da271b72',
    'p0a-runner/m1.3': '854a48427f10ead508a2fa839bdd1443e99002ab7387b1bdb65bc7e9e8502134',
  };

  it('★m1.0 历史向量冻结（改 m1.0 公式即失配）', () => {
    expect(computeReportHash(fixedReportBody('p0a-runner/m1.0'))).toBe(VECTORS['p0a-runner/m1.0']);
  });
  it('★m1.1 历史向量冻结（改 m1.1 公式即失配——保护既有报告 + 绑其的 approval）', () => {
    expect(computeReportHash(fixedReportBody('p0a-runner/m1.1'))).toBe(VECTORS['p0a-runner/m1.1']);
  });
  it('★m1.2 历史向量冻结（含 caseHash，加 m1.3 后不得漂移）', () => {
    expect(computeReportHash(fixedReportBody('p0a-runner/m1.2'))).toBe(VECTORS['p0a-runner/m1.2']);
  });
  it('★m1.3 向量锁定（新公式含 signability）', () => {
    expect(computeReportHash(fixedReportBody('p0a-runner/m1.3'))).toBe(VECTORS['p0a-runner/m1.3']);
  });

  it('★五路版本分派：m1.0/m1.1/m1.2/m1.3 各不相同，未知 fail-closed', () => {
    const hs = ['m1.0', 'm1.1', 'm1.2', 'm1.3'].map((v) => computeReportHash(fixedReportBody(`p0a-runner/${v}`)));
    expect(new Set(hs).size).toBe(4); // 四公式互不相同。
    expect(() => computeReportHash(fixedReportBody('p0a-runner/CORRUPT'))).toThrow(/unsupported reportHash runnerVersion/);
  });

  it('★m1.3 敏感于 signability（改签字资格 → reportHash 变）', () => {
    const signable = fixedReportBody('p0a-runner/m1.3');
    const unsignable = { ...signable, signability: 'UNSIGNABLE_LEGACY_CASE_HASH_VERSION' as const, unsignableLegacyCases: 1 };
    expect(computeReportHash(signable)).not.toBe(computeReportHash(unsignable));
  });
  it('m1.2 公式忽略 signability（历史 m1.2 报告不因 signability 字段而变）', () => {
    const body = fixedReportBody('p0a-runner/m1.2');
    const withDiff = { ...body, signability: 'UNSIGNABLE_LEGACY_CASE_HASH_VERSION' as const, unsignableLegacyCases: 3 };
    // m1.2 公式不纳入 signability → 改它不影响 m1.2 hash。
    expect(computeReportHash(body)).toBe(computeReportHash(withDiff));
  });

  it('★m1.2 敏感于 caseHash（改 caseHash → reportHash 变，锚定 golden 完整性）', () => {
    const body = fixedReportBody('p0a-runner/m1.2');
    const tampered = { ...body, cases: body.cases.map((c) => ({ ...c, caseHash: 'TAMPERED' })) };
    expect(computeReportHash(body)).not.toBe(computeReportHash(tampered));
  });
  it('★m1.2 敏感于 caseHashVersion（算法域分离进 hash）', () => {
    const body = fixedReportBody('p0a-runner/m1.2');
    const tampered = { ...body, cases: body.cases.map((c) => ({ ...c, caseHashVersion: 'case-hash/m1.0' })) };
    expect(computeReportHash(body)).not.toBe(computeReportHash(tampered));
  });
  it('m1.1 公式忽略 caseHash（历史报告不因 detail 多带 caseHash 而变）', () => {
    const body = fixedReportBody('p0a-runner/m1.1');
    const withDiffCaseHash = { ...body, cases: body.cases.map((c) => ({ ...c, caseHash: 'DIFFERENT' })) };
    // m1.1 公式不纳入 caseHash → 改它不影响 m1.1 hash。
    expect(computeReportHash(body)).toBe(computeReportHash(withDiffCaseHash));
  });
});

describe('verifyReportIntegrity — 离线核验协议（消费 m1.2 承诺 + 当前行重算自洽）', () => {
  // 一个 case 的 computeCaseHash 字段（可控），caseHash 由这些字段算出（自洽）。
  const CASE_FIELDS = {
    policyId: 'pol-1', policyVersionRowId: 'pv-1', functionName: 'greet', locale: 'en-US',
    canonicalInputHash: 'in1', expectedOutputHash: 'out1', canonicalizationVersion: 'aster-canonical-json/v1',
    aliasSetJson: {}, vocabSnapshotRef: [], sourceKind: 'execution',
    expectedDecision: 'approved' as const, coverageTags: [] as string[],
    baselineRuntimeToolchainId: 'tc-base', sourceToolchainId: 'tc-src',
    sourceEnvelopeSha256: 'env1', sourceExecutionId: 'ex1',
  };
  const CASE_ID = 'ck-1';
  const SELF_CASE_HASH = computeCaseHash(CASE_FIELDS, CASE_HASH_VERSION);

  /** 自洽 golden 行（存储 caseHash = 从字段重算）。 */
  const selfConsistentGolden = (over: Partial<GoldenCaseSnapshot> = {}): GoldenCaseSnapshot => ({
    id: CASE_ID, caseHash: SELF_CASE_HASH, caseHashVersion: CASE_HASH_VERSION, ...CASE_FIELDS, ...over,
  });

  /** 承诺该 case 的 m1.2 报告（committed caseHash = SELF_CASE_HASH）。 */
  const reportCommitting = (committedHash: string = SELF_CASE_HASH): Omit<RunReport, 'reportId' | 'reportHash'> => {
    const body = fixedReportBody('p0a-runner/m1.2');
    body.cases[0] = { ...body.cases[0], caseId: CASE_ID, caseHash: committedHash, caseHashVersion: CASE_HASH_VERSION };
    return body;
  };

  it('★全 MATCH：报告承诺 == 存储 == 重算，三者一致 → ok', () => {
    const body = reportCommitting();
    const v = verifyReportIntegrity(body, computeReportHash(body), [selfConsistentGolden()]);
    expect(v.ok).toBe(true);
    expect(v.reportHashValid).toBe(true);
    expect(v.structurallyValid).toBe(true);
    expect(v.goldenCommitmentSupported).toBe(true);
    expect(v.cases[0].status).toBe('MATCH');
    expect(v.cases[0].recomputedCaseHash).toBe(SELF_CASE_HASH);
  });

  it('★reportHash 被改 → reportHashValid=false, ok=false', () => {
    const body = reportCommitting();
    const v = verifyReportIntegrity(body, 'WRONG-REPORT-HASH', [selfConsistentGolden()]);
    expect(v.reportHashValid).toBe(false);
    expect(v.ok).toBe(false);
  });

  it('★致命攻击 A：改被 hash 字段但**不改** caseHash（当前行不自洽）→ CURRENT_GOLDEN_INTEGRITY_FAILURE', () => {
    // 攻击者直改 expectedOutputHash，但保留原 caseHash（更简单的攻击）。verifier 从字段重算 → 与存储不符。
    const body = reportCommitting();
    const tamperedRow = selfConsistentGolden({ expectedOutputHash: 'TAMPERED-OUTPUT' }); // caseHash 仍 SELF（未改）。
    const v = verifyReportIntegrity(body, computeReportHash(body), [tamperedRow]);
    expect(v.cases[0].status).toBe('CURRENT_GOLDEN_INTEGRITY_FAILURE');
    expect(v.cases[0].currentCaseHash).toBe(SELF_CASE_HASH);
    expect(v.cases[0].recomputedCaseHash).not.toBe(SELF_CASE_HASH); // 重算 ≠ 存储 → 抓出。
    expect(v.ok).toBe(false);
  });

  it('★致命攻击 B：改字段 + 重算自洽 caseHash（run 自洽过）→ CASE_HASH_MISMATCH（与签字承诺不符）', () => {
    // 当前行内部自洽（caseHash 随字段重算），但与报告签字时承诺的 caseHash 不同 → 抓出。
    const body = reportCommitting(); // 承诺原始 SELF_CASE_HASH。
    const newFields = { ...CASE_FIELDS, expectedOutputHash: 'TAMPERED-OUTPUT' };
    const newHash = computeCaseHash(newFields, CASE_HASH_VERSION);
    expect(newHash).not.toBe(SELF_CASE_HASH);
    const rowSelfConsistentButChanged = selfConsistentGolden({ ...newFields, caseHash: newHash });
    const v = verifyReportIntegrity(body, computeReportHash(body), [rowSelfConsistentButChanged]);
    expect(v.cases[0].status).toBe('CASE_HASH_MISMATCH'); // 当前行自洽但 ≠ 承诺。
    expect(v.ok).toBe(false);
  });

  it('★未知 caseHashVersion → UNSUPPORTED_CASE_HASH_VERSION（fail-closed）', () => {
    const body = reportCommitting();
    const v = verifyReportIntegrity(body, computeReportHash(body), [selfConsistentGolden({ caseHashVersion: 'case-hash/CORRUPT' })]);
    expect(v.cases[0].status).toBe('UNSUPPORTED_CASE_HASH_VERSION');
    expect(v.ok).toBe(false);
  });

  it('★golden 缺失 → MISSING_IN_GOLDEN, ok=false', () => {
    const body = reportCommitting();
    const v = verifyReportIntegrity(body, computeReportHash(body), []);
    expect(v.cases[0].status).toBe('MISSING_IN_GOLDEN');
    expect(v.ok).toBe(false);
  });

  it('★golden 多出未覆盖 case → EXTRA_IN_GOLDEN, ok=false（覆盖集变化）', () => {
    const body = reportCommitting();
    const extra = selfConsistentGolden({ id: 'extra-case' });
    const v = verifyReportIntegrity(body, computeReportHash(body), [selfConsistentGolden(), extra]);
    expect(v.cases.some((c) => c.status === 'EXTRA_IN_GOLDEN' && c.caseId === 'extra-case')).toBe(true);
    expect(v.ok).toBe(false);
  });

  it('★结构 fail-closed：报告出现重复 caseId → structurallyValid=false, ok=false', () => {
    const body = reportCommitting();
    body.cases = [body.cases[0], { ...body.cases[0] }]; // 重复 caseId（同 id 两条 detail）。
    const v = verifyReportIntegrity(body, computeReportHash(body), [selfConsistentGolden()]);
    expect(v.structurallyValid).toBe(false);
    expect(v.ok).toBe(false);
  });

  it('★m1.0/m1.1 报告不支持 golden 承诺 → goldenCommitmentSupported=false, ok=false', () => {
    // 旧版报告没绑 caseHash → 即使当前行自洽也不能证明它对应签字承诺（诚实标注）。
    const m11 = fixedReportBody('p0a-runner/m1.1');
    m11.cases[0] = { ...m11.cases[0], caseId: CASE_ID };
    const v = verifyReportIntegrity(m11, computeReportHash(m11), [selfConsistentGolden()]);
    expect(v.reportHashValid).toBe(true);
    expect(v.goldenCommitmentSupported).toBe(false);
    expect(v.cases[0].status).toBe('CASE_HASH_MISMATCH'); // 当前行自洽但报告没承诺 → 不 MATCH。
    expect(v.ok).toBe(false);
  });
});

// ============ Item 2：legacy m1.0 签字策略（signability 轴 + verify 弱绑定态） ============

describe('signability — assembleReport 报告级签字资格（Item 2）', () => {
  const detail = (caseId: string, over: Partial<CaseRunDetail> = {}): CaseRunDetail => ({
    caseId, status: 'PASS', caseHash: `${caseId}-h`, caseHashVersion: CASE_HASH_VERSION,
    functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution',
    expectedOutputHash: 'h', actualOutputHash: 'h', ...over,
  });

  it('★全 m1.1 case（无 legacy）→ legacy 维度干净（count=0）；但 PASS 报告仍 UNSIGNABLE（provenance 维度，F）', () => {
    // ★Item 4 F：signability 是**多维复合**——legacy 维度干净（unsignableLegacyCases=0）不代表可签字。
    // 此报告 status===PASS（声称跨升级门禁通过）→ 恒加 TOOLCHAIN_PROVENANCE_UNVERIFIED → 顶层 UNSIGNABLE。
    const { cases, details } = coverageSatisfyingCases();
    const r = assemble(cases, details);
    expect(r.unsignableLegacyCases).toBe(0); // legacy 维度干净
    expect(r.unsignableReasons).toEqual(['TOOLCHAIN_PROVENANCE_UNVERIFIED']); // 唯一 reason=provenance
    expect(r.signability).toBe('UNSIGNABLE'); // 复合结果：因 provenance 不可签字
  });

  it('★含 LEGACY_UNSIGNABLE case → signability=UNSIGNABLE（即使 status 达标）', () => {
    // 4 强 case 覆盖达标（PASS）+ 1 个 legacy-unsignable（非 runnable）。status 可能 PASS，但 signability=UNSIGNABLE。
    const { cases, details } = coverageSatisfyingCases();
    cases.push({ id: 'legacy', expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] });
    details.push(detail('legacy', { status: 'NON_REPLAYABLE', reason: 'LEGACY_UNSIGNABLE_CASE_HASH_VERSION', caseHashVersion: CASE_HASH_VERSION_M10 }));
    const r = assemble(cases, details);
    // ★双口径防护：报告级 signability 宣告不可签字，不靠调用方看 case。
    expect(r.signability).toBe('UNSIGNABLE');
    expect(r.unsignableLegacyCases).toBe(1);
    // 可签字通过 = status===PASS && signability===SIGNABLE → 此报告不满足。
    expect(r.status === 'PASS' && r.signability === 'SIGNABLE').toBe(false);
  });
});

describe('verifyReportIntegrity — m1.0 golden 弱绑定 + m1.3 承诺（Item 2）', () => {
  // 自洽的 m1.0 golden 行（用 m1.0 公式算 caseHash）。
  const M10_FIELDS = {
    policyId: 'pol-1', policyVersionRowId: 'pv-1', functionName: 'greet', locale: 'en-US',
    canonicalInputHash: 'in1', expectedOutputHash: 'out1', canonicalizationVersion: 'aster-canonical-json/v1',
    aliasSetJson: {}, vocabSnapshotRef: [], sourceKind: 'execution',
    expectedDecision: 'approved' as const, coverageTags: [] as string[],
    baselineRuntimeToolchainId: 'tc-base', sourceToolchainId: 'tc-src',
    sourceEnvelopeSha256: 'env1', sourceExecutionId: 'ex1',
  };
  const M10_ID = 'legacy-case';
  const M10_HASH = computeCaseHash(M10_FIELDS, CASE_HASH_VERSION_M10);

  const m10Golden = (): GoldenCaseSnapshot => ({
    id: M10_ID, caseHash: M10_HASH, caseHashVersion: CASE_HASH_VERSION_M10, ...M10_FIELDS,
  });
  const reportCommittingM10 = (version: string): Omit<RunReport, 'reportId' | 'reportHash'> => {
    const body = fixedReportBody(version);
    body.cases[0] = { ...body.cases[0], caseId: M10_ID, caseHash: M10_HASH, caseHashVersion: CASE_HASH_VERSION_M10 };
    return body;
  };

  it('★m1.0 golden 自洽且匹配承诺，但弱绑定 → LEGACY_WEAK_BINDING_CASE_HASH_VERSION（不计 MATCH）', () => {
    const body = reportCommittingM10('p0a-runner/m1.3');
    const v = verifyReportIntegrity(body, computeReportHash(body), [m10Golden()]);
    // 三者相等（committed==stored==recomputed 都是 m1.0 公式），但 caseHashVersion 弱绑定。
    expect(v.cases[0].status).toBe('LEGACY_WEAK_BINDING_CASE_HASH_VERSION');
    expect(v.ok).toBe(false); // 弱绑定不足签字。
  });

  it('★弱绑定诊断对所有报告版本一致（m1.2 报告 + m1.0 golden 也标弱绑定）', () => {
    const body = reportCommittingM10('p0a-runner/m1.2');
    const v = verifyReportIntegrity(body, computeReportHash(body), [m10Golden()]);
    expect(v.cases[0].status).toBe('LEGACY_WEAK_BINDING_CASE_HASH_VERSION');
    expect(v.ok).toBe(false);
  });

  it('★m1.3 报告支持 golden 承诺（goldenCommitmentSupported=true，与 m1.2 同）', () => {
    // 用 m1.1（可签字）case 确认 m1.3 报告的 goldenCommitmentSupported。
    const body = fixedReportBody('p0a-runner/m1.3');
    const g: GoldenCaseSnapshot = {
      id: body.cases[0].caseId, caseHash: body.cases[0].caseHash, caseHashVersion: CASE_HASH_VERSION,
      policyId: 'pol-1', policyVersionRowId: 'pv-1', functionName: 'greet', locale: 'en-US',
      canonicalInputHash: 'in1', expectedOutputHash: 'out1', canonicalizationVersion: 'aster-canonical-json/v1',
      aliasSetJson: {}, vocabSnapshotRef: [], sourceKind: 'execution', expectedDecision: 'approved',
      coverageTags: [], baselineRuntimeToolchainId: 'tc-base', sourceToolchainId: 'tc-src',
      sourceEnvelopeSha256: 'env1', sourceExecutionId: 'ex1',
    };
    // committed caseHash 与 g.caseHash 不同（body 的 caseHash 是假串），故非 MATCH，但确认 goldenCommitmentSupported。
    const v = verifyReportIntegrity(body, computeReportHash(body), [g]);
    expect(v.goldenCommitmentSupported).toBe(true);
  });
});

// ============ Item 2 复审补强：signability 从 caseHashVersion 派生 + 消费链闭合 ============

describe('signability 从 caseHashVersion 事实派生（非 reason）— Codex 复审致命 1', () => {
  const det = (caseId: string, caseHashVersion: string, over: Partial<CaseRunDetail> = {}): CaseRunDetail => ({
    caseId, status: 'NON_REPLAYABLE', caseHash: `${caseId}-h`, caseHashVersion,
    functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution', ...over,
  });
  // 4 强 case 达标 + 1 个变体 legacy。
  const withLegacy = (legacyDetail: CaseRunDetail) => {
    const { cases, details } = coverageSatisfyingCases();
    cases.push({ id: legacyDetail.caseId, expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] });
    details.push(legacyDetail);
    return assemble(cases, details);
  };

  it('★m1.0 case 自洽（reason=legacy）→ UNSIGNABLE', () => {
    const r = withLegacy(det('lg', CASE_HASH_VERSION_M10, { reason: 'LEGACY_UNSIGNABLE_CASE_HASH_VERSION' }));
    expect(r.signability).toBe('UNSIGNABLE');
    expect(r.unsignableLegacyCases).toBe(1);
  });

  it('★致命：m1.0 case **不自洽**（reason=GOLDEN_INTEGRITY_FAILURE，非 legacy）仍 UNSIGNABLE', () => {
    // 这是 Codex 抓的漏判：用 reason 反推会漏（reason 是 integrity failure），必须用 caseHashVersion 事实。
    const r = withLegacy(det('lg', CASE_HASH_VERSION_M10, { status: 'FAIL_REGRESSION', reason: 'GOLDEN_INTEGRITY_FAILURE' }));
    expect(r.signability).toBe('UNSIGNABLE');
  });

  it('★未知 caseHashVersion（非 signable）→ UNSIGNABLE', () => {
    const r = withLegacy(det('lg', 'case-hash/CORRUPT', { status: 'FAIL_REGRESSION', reason: 'GOLDEN_INTEGRITY_FAILURE_UNKNOWN_VERSION' }));
    expect(r.signability).toBe('UNSIGNABLE');
  });

  it('全 m1.1 → legacy 维度干净（casesDerivedSignability=SIGNABLE, count=0）；复合仍 UNSIGNABLE（provenance）', () => {
    // ★本块专测 legacy 维度（caseHashVersion 事实派生）。全 m1.1 → legacy 干净。但 PASS 报告叠加 provenance
    // 维度 → 复合 signability=UNSIGNABLE（F）。用 casesDerivedSignability 隔离验证 legacy 维度本身干净。
    const { cases, details } = coverageSatisfyingCases();
    const d = _drsd(assemble(cases, details));
    expect(d.casesDerivedSignability).toBe('SIGNABLE'); // legacy 维度干净
    expect(d.unsignableLegacyCases).toBe(0);
    expect(d.signability).toBe('UNSIGNABLE'); // 复合：provenance 维度
    expect(d.unsignableReasons).toEqual(['TOOLCHAIN_PROVENANCE_UNVERIFIED']);
  });
});

describe('deriveReportSignability / isSignablePass — 统一消费入口（legacy 维度隔离）', () => {
  // ★Item 4 F：provenance 维度由**报告 status 事实**驱动（status===PASS 或有可审批 OUTPUT_HASH_MISMATCH →
  // 声称跨升级安全 → 恒加 TOOLCHAIN_PROVENANCE_UNVERIFIED）。为**纯**测 legacy 维度，须用一个**不声称跨升级**
  // 的 status——FAIL_INSUFFICIENT_COVERAGE（覆盖不足，未通过跨升级门禁，不需 provenance）。★关键：不能再靠改
  // toolchain 字段隔离（那是被 Codex 判为自证漏洞的旧路径——字段可删可改）。provenance 维度见下方 F 专属 describe。
  const isolateLegacy = (body: ReturnType<typeof fixedReportBody>) => ({
    ...body,
    status: 'FAIL_INSUFFICIENT_COVERAGE' as const,
    cases: body.cases.map((c) => ({ ...c, status: 'PASS' as const, reason: undefined })),
  });
  const m13 = (sig: 'SIGNABLE' | 'UNSIGNABLE_LEGACY_CASE_HASH_VERSION') => ({
    ...isolateLegacy(fixedReportBody('p0a-runner/m1.3')), signability: sig,
  });

  it('m1.3：读顶层 signability（非跨升级 status，无 provenance 干扰）', () => {
    expect(deriveReportSignability(m13('SIGNABLE'))).toBe('SIGNABLE');
    expect(deriveReportSignability(m13('UNSIGNABLE_LEGACY_CASE_HASH_VERSION'))).toBe('UNSIGNABLE');
  });

  it('m1.2：从 cases caseHashVersion 派生（含 m1.0 case → UNSIGNABLE）', () => {
    const clean = isolateLegacy(fixedReportBody('p0a-runner/m1.2'));
    expect(deriveReportSignability(clean)).toBe('SIGNABLE');
    const withM10 = { ...clean, cases: clean.cases.map((c) => ({ ...c, caseHashVersion: CASE_HASH_VERSION_M10 })) };
    expect(deriveReportSignability(withM10)).toBe('UNSIGNABLE');
  });

  it('m1.0/m1.1 报告（无 golden 承诺）→ 一律 UNSIGNABLE', () => {
    expect(deriveReportSignability(isolateLegacy(fixedReportBody('p0a-runner/m1.1')))).toBe('UNSIGNABLE');
    expect(deriveReportSignability(isolateLegacy(fixedReportBody('p0a-runner/m1.0')))).toBe('UNSIGNABLE');
  });

  it('★isSignablePass 铁律：唯有 status===PASS && 派生 SIGNABLE 才 true——但 PASS 恒触发 provenance → 当前生态永不为 true（F 诚实降级）', () => {
    // ★F 的核心诚实结论：可签字通过 = status===PASS && signability===SIGNABLE。而 status===PASS 恒加
    // provenance reason（无 runtime 第 3 层）→ signability===UNSIGNABLE → isSignablePass 恒 false。
    // 即使人为把 signability 声明成 SIGNABLE（造假），派生仍从 status 事实判 provenance → false（防绿色可签字双口径）。
    const passClaimingSignable = { ...fixedReportBody('p0a-runner/m1.3'), signability: 'SIGNABLE' as const, status: 'PASS' as const };
    expect(deriveReportSignability(passClaimingSignable)).toBe('UNSIGNABLE'); // provenance 覆盖伪造声明
    expect(isSignablePass(passClaimingSignable)).toBe(false);
    // 非 PASS 的 SIGNABLE 报告（legacy 隔离态）signability 可为 SIGNABLE，但 status≠PASS → 仍非「可签字通过」。
    expect(isSignablePass(m13('SIGNABLE'))).toBe(false); // status===FAIL_INSUFFICIENT_COVERAGE
    expect(isSignablePass({ ...m13('UNSIGNABLE_LEGACY_CASE_HASH_VERSION'), status: 'PASS' })).toBe(false);
  });
});

describe('computeEffectiveStatus — 不可签字报告绝不派生 ACCEPTED（Codex 复审致命 3）', () => {
  const PVR = 'pv-eff';
  const now = new Date('2026-07-18T00:00:00.000Z');
  const mkCase = (caseId: string, caseHashVersion: string): CaseRunDetail => ({
    caseId, status: 'FAIL_REGRESSION', reason: 'OUTPUT_HASH_MISMATCH',
    expectedOutputHash: 'b1', actualOutputHash: 'n1', caseHash: `${caseId}-h`, caseHashVersion,
    functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution',
  });
  const approval = {
    reportHash: 'rh', policyVersionRowId: PVR, reason: 'r', ticketRef: null, approvedBy: 'user-b',
    expiresAt: new Date('2027-01-01T00:00:00.000Z'), revokedAt: null,
    acceptedDrifts: [{ caseId: 'c1', baselineOutputHash: 'b1', acceptedOutputHash: 'n1' }],
    approvalHash: computeApprovalHash({
      reportHash: 'rh', policyVersionRowId: PVR,
      acceptedDrifts: [{ caseId: 'c1', baselineOutputHash: 'b1', acceptedOutputHash: 'n1' }],
      reason: 'r', ticketRef: null, approvedBy: 'user-b', expiresAt: '2027-01-01T00:00:00.000Z',
    }),
  };

  it('★signable 报告 + 有效审批 → ACCEPTED（对照，确认正常路径仍工作）', () => {
    const report = {
      status: 'FAIL_REGRESSION' as const, reportHash: 'rh', policyVersionRowId: PVR,
      cases: [mkCase('c1', CASE_HASH_VERSION)], runnerVersion: 'p0a-runner/m1.3' as const,
      signability: 'SIGNABLE' as const, unsignableLegacyCases: 0,
    };
    expect(computeEffectiveStatus(report, [approval], now)).toBe('ACCEPTED_DRIFT_WITH_APPROVAL');
  });

  it('★不可签字报告（含真 m1.0 case）+ 同样的有效审批 → 仍 FAIL_REGRESSION（绝不 ACCEPTED）', () => {
    // 真 m1.0 case（cases 派生 UNSIGNABLE）→ 即使审批精确覆盖 drift 也不派生 ACCEPTED。
    const report = {
      status: 'FAIL_REGRESSION' as const, reportHash: 'rh', policyVersionRowId: PVR,
      cases: [mkCase('c1', CASE_HASH_VERSION_M10)],
      runnerVersion: 'p0a-runner/m1.3' as const, signability: 'UNSIGNABLE_LEGACY_CASE_HASH_VERSION' as const,
      unsignableLegacyCases: 1,
    };
    expect(computeEffectiveStatus(report, [approval], now)).toBe('FAIL_REGRESSION');
  });
});

// ============ Item 2 复审2补强：m1.3 顶层 signability 自洽性 fail-closed（Codex 复审致命）============

describe('deriveReportSignability — m1.3 顶层声明必须与 cases 一致（fail-closed）', () => {
  it('★致命：m1.3 声明 SIGNABLE 但 cases 含 m1.0（矛盾）→ fail-closed UNSIGNABLE', () => {
    // 自洽 reportHash 但内部矛盾的 artifact：cases 有 m1.0，却顶层声明 SIGNABLE/count=0。
    // ★用 status=FAIL_INSUFFICIENT_COVERAGE（非跨升级，不触发 provenance）——**隔离** fail-closed 机制，
    // 确保 UNSIGNABLE 来自「声明矛盾」而非被 provenance 维度掩盖（否则测试无法证明 fail-closed 真起作用）。
    const body = fixedReportBody('p0a-runner/m1.3');
    const lying = {
      ...body,
      status: 'FAIL_INSUFFICIENT_COVERAGE' as const,
      cases: body.cases.map((c) => ({ ...c, status: 'PASS' as const, caseHashVersion: CASE_HASH_VERSION_M10 })),
      signability: 'SIGNABLE' as const,
      unsignableLegacyCases: 0,
    };
    const d = _drsd(lying);
    expect(d.declaredConsistent).toBe(false); // 声明矛盾被抓（核心断言，非 provenance 副作用）
    expect(d.signability).toBe('UNSIGNABLE'); // fail-closed
    expect(isSignablePass({ ...lying, status: 'PASS' })).toBe(false);
  });

  it('★count 不一致（全 m1.1 但声明 unsignableLegacyCases=1）→ fail-closed UNSIGNABLE', () => {
    // 同样用非跨升级 status 隔离 fail-closed（防 provenance 掩盖）。
    const body = fixedReportBody('p0a-runner/m1.3'); // cases 全 m1.1（signable）
    const inconsistent = {
      ...body,
      status: 'FAIL_INSUFFICIENT_COVERAGE' as const,
      cases: body.cases.map((c) => ({ ...c, status: 'PASS' as const })),
      signability: 'SIGNABLE' as const,
      unsignableLegacyCases: 1,
    };
    const d = _drsd(inconsistent);
    expect(d.declaredConsistent).toBe(false); // count 矛盾被抓
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('m1.3 声明与 cases 一致 → 返回声明值（隔离 legacy 维度：用非跨升级 status，不靠可删的 toolchain 字段）', () => {
    // ★Item 4 F：provenance 由 status 事实驱动（非 toolchain 字段——那是 Codex 判定的自证漏洞路径）。为隔离
    // legacy 维度，用 status=FAIL_INSUFFICIENT_COVERAGE（不声称跨升级，不触发 provenance）。
    const base = fixedReportBody('p0a-runner/m1.3');
    const signable = {
      ...base,
      status: 'FAIL_INSUFFICIENT_COVERAGE' as const,
      cases: base.cases.map((c) => ({ ...c, status: 'PASS' as const })),
    };
    expect(deriveReportSignability(signable)).toBe('SIGNABLE');
    const unsignable = {
      ...signable,
      cases: signable.cases.map((c) => ({ ...c, caseHashVersion: CASE_HASH_VERSION_M10 })),
      signability: 'UNSIGNABLE_LEGACY_CASE_HASH_VERSION' as const,
      unsignableLegacyCases: 1,
    };
    expect(deriveReportSignability(unsignable)).toBe('UNSIGNABLE');
  });

  it('★伪造 m1.3 SIGNABLE + m1.0 case + 有效审批 → computeEffectiveStatus 仍 FAIL_REGRESSION（不 ACCEPTED）', () => {
    const now = new Date('2026-07-18T00:00:00.000Z');
    const drift = { caseId: 'c1', baselineOutputHash: 'b1', acceptedOutputHash: 'n1' };
    const approval = {
      reportHash: 'rh', policyVersionRowId: 'pv', reason: 'r', ticketRef: null, approvedBy: 'user-b',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'), revokedAt: null, acceptedDrifts: [drift],
      approvalHash: computeApprovalHash({
        reportHash: 'rh', policyVersionRowId: 'pv', acceptedDrifts: [drift], reason: 'r', ticketRef: null,
        approvedBy: 'user-b', expiresAt: '2027-01-01T00:00:00.000Z',
      }),
    };
    // 伪造：cases 含 m1.0 FAIL case，但顶层谎称 SIGNABLE。
    const report = {
      status: 'FAIL_REGRESSION' as const, reportHash: 'rh', policyVersionRowId: 'pv',
      cases: [{
        caseId: 'c1', status: 'FAIL_REGRESSION' as const, reason: 'OUTPUT_HASH_MISMATCH',
        expectedOutputHash: 'b1', actualOutputHash: 'n1', caseHash: 'c1-h', caseHashVersion: CASE_HASH_VERSION_M10,
        functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution',
      }],
      runnerVersion: 'p0a-runner/m1.3' as const, signability: 'SIGNABLE' as const, unsignableLegacyCases: 0,
    };
    // deriveReportSignability 从 cases 派生 UNSIGNABLE（顶层谎言不被信）→ 不 ACCEPTED。
    expect(computeEffectiveStatus(report, [approval], now)).toBe('FAIL_REGRESSION');
  });
});

// ============ Item 2 复审3：verify verdict.ok 纳入 signability 声明自洽性 ============

describe('verifyReportIntegrity — signabilityConsistent 纳入 ok（Codex 复审）', () => {
  // 自洽 golden（caseHash = 从字段用 m1.1 公式重算），供 verify 三段全 MATCH。
  const FIELDS = {
    policyId: 'pol-1', policyVersionRowId: 'pv-1', functionName: 'greet', locale: 'en-US',
    canonicalInputHash: 'in1', expectedOutputHash: 'out1', canonicalizationVersion: 'aster-canonical-json/v1',
    aliasSetJson: {}, vocabSnapshotRef: [], sourceKind: 'execution', expectedDecision: 'approved' as const,
    coverageTags: [] as string[], baselineRuntimeToolchainId: 'tc-base', sourceToolchainId: 'tc-src',
    sourceEnvelopeSha256: 'env1', sourceExecutionId: 'ex1',
  };
  const SELF_HASH = computeCaseHash(FIELDS, CASE_HASH_VERSION);
  const CID = fixedReportBody('p0a-runner/m1.3').cases[0].caseId;
  const golden = (): GoldenCaseSnapshot => ({ id: CID, caseHash: SELF_HASH, caseHashVersion: CASE_HASH_VERSION, ...FIELDS });
  // m1.3 报告，其 case 承诺 SELF_HASH（与自洽 golden 全 MATCH）。
  const reportM13 = (over: { unsignableLegacyCases?: number } = {}) => {
    const b = fixedReportBody('p0a-runner/m1.3');
    return {
      ...b,
      cases: b.cases.map((c) => ({ ...c, caseId: CID, caseHash: SELF_HASH, caseHashVersion: CASE_HASH_VERSION })),
      ...over,
    };
  };

  it('★m1.3 count 声明错误（全 m1.1 case 但 unsignableLegacyCases=1）→ signabilityConsistent=false, ok=false', () => {
    const lying = reportM13({ unsignableLegacyCases: 1 }); // 声明 count=1，派生应为 0（矛盾）
    const v = verifyReportIntegrity(lying, computeReportHash(lying), [golden()]);
    expect(v.reportHashValid).toBe(true);
    expect(v.signabilityConsistent).toBe(false); // 声明 count 与事实不符。
    expect(v.ok).toBe(false); // 纳入 ok（消除 verify「完整性 ok」+「不可签字」双口径）。
    expect(v.derivedSignability).toBe('SIGNABLE'); // 事实派生（cases 全 m1.1）。
  });

  it('m1.3 声明一致 + cases MATCH → signabilityConsistent=true, ok=true', () => {
    const body = reportM13(); // 全 m1.1, SIGNABLE, count 0（一致）
    const v = verifyReportIntegrity(body, computeReportHash(body), [golden()]);
    expect(v.signabilityConsistent).toBe(true);
    expect(v.cases[0].status).toBe('MATCH');
    expect(v.ok).toBe(true);
  });
});

// ============ F1/F2（独立审查发现的 defense-in-depth 加固）============

describe('verifyReportIntegrity — F2：空报告不给空证明 ok', () => {
  it('★0 case 报告对空 golden → ok=false（非 vacuous true）', () => {
    const empty: Omit<RunReport, 'reportId' | 'reportHash'> = {
      status: 'NON_REPLAYABLE', comparisonMode: 'FROZEN_BASELINE_VS_CURRENT_BACKEND', baselineSemantics: 'sem',
      policyId: 'p', policyVersionRowId: 'v', currentRuntimeToolchainId: null,
      coverage: { totalCases: 0, runnableCases: 0, approvedCases: 0, deniedCases: 0, handwrittenBoundaryCases: 0,
        thresholds: { minRunnableCases: 4, minApprovedCases: 1, minDeniedCases: 1, minHandwrittenBoundaryCases: 1 }, unmet: [] },
      summary: { passed: 0, failed: 0, nonReplayable: 0, compileFailures: 0 },
      cases: [], runnerVersion: 'p0a-runner/m1.3', signability: 'SIGNABLE', unsignableLegacyCases: 0,
    };
    const v = verifyReportIntegrity(empty, computeReportHash(empty), []);
    // reportHash 有效 + 无 case mismatch，但**无覆盖 case**→不构成签字级证据。
    expect(v.reportHashValid).toBe(true);
    expect(v.ok).toBe(false);
  });
});

// ============ Item 4 F：toolchain provenance 诚实降级（m1.4）============

describe('Item 4 F — toolchain provenance 诚实降级（m1.4）', () => {
  // 有跨 toolchain 证据的 case（baseline≠current）——声称跨升级安全。
  const crossToolchainCase = (over: Partial<CaseRunDetail> = {}): CaseRunDetail => ({
    caseId: 'c1', status: 'PASS', caseHash: 'c1-h', caseHashVersion: CASE_HASH_VERSION,
    functionName: 'f', locale: 'en-US', coverageTags: [], sourceKind: 'execution',
    baselineToolchainId: 'tc-base', currentToolchainId: 'tc-cur', ...over,
  });
  // ★m1.4 报告顶层 signability = **真二值**（任一 reason 非空→'UNSIGNABLE'，与 assembleReport 一致）。
  // ★Codex 复审致命 3：provenance-only 报告顶层绝不能返回 'UNSIGNABLE_LEGACY_CASE_HASH_VERSION'（自相矛盾——
  // 明明不是 legacy 原因）。m1.4 只用真二值 'SIGNABLE' | 'UNSIGNABLE'。
  const m14 = (cases: CaseRunDetail[], reasons: _UR[], legacyCount = 0) => ({
    ...fixedReportBody('p0a-runner/m1.4'), cases, unsignableReasons: reasons,
    signability: (reasons.length > 0 ? 'UNSIGNABLE' : 'SIGNABLE') as 'SIGNABLE' | 'UNSIGNABLE',
    unsignableLegacyCases: legacyCount,
  });

  it('★m1.4 golden 向量冻结（含 reasons 进 hash）', () => {
    // 硬编码向量：改 m1.4 公式即失配；空 reasons vs 含 provenance 不同（reasons 真进 hash）。
    const base = fixedReportBody('p0a-runner/m1.4');
    expect(computeReportHash({ ...base, unsignableReasons: [] }))
      .toBe('dac8baf5cb818519010727e19fb8b002333c2f2a0559add9ce370509506a8f15');
    expect(computeReportHash({ ...base, unsignableReasons: ['TOOLCHAIN_PROVENANCE_UNVERIFIED'] }))
      .toBe('49405a514302e96732526941f86b5a64764d75d0fdb27d8dbaeb78d1e9a5d04e');
  });

  it('★核心：有跨 toolchain 证据的报告 → TOOLCHAIN_PROVENANCE_UNVERIFIED → UNSIGNABLE（F 诚实降级）', () => {
    const d = _drsd(m14([crossToolchainCase()], ['TOOLCHAIN_PROVENANCE_UNVERIFIED']));
    expect(d.unsignableReasons).toContain('TOOLCHAIN_PROVENANCE_UNVERIFIED');
    expect(d.signability).toBe('UNSIGNABLE');
    expect(d.declaredConsistent).toBe(true); // 顶层声明与派生一致。
  });

  it('★Codex 复审致命 1：PASS 报告即便 baseline===current 也 UNSIGNABLE（provenance 由 status 派生，非可删/可改的 toolchain 字段）', () => {
    // ★自证漏洞防线：旧实现用 case 的 toolchain pair 当「是否需 provenance」开关——攻击者把 baseline 设成
    // ===current（或删字段）即消除 reason 洗白成 SIGNABLE。现由 **status===PASS 事实**判定（报告声称跨升级
    // 门禁通过），toolchain 字段仅诊断。故 PASS 报告无论 toolchain 字段如何都恒 UNSIGNABLE。
    const same = crossToolchainCase({ baselineToolchainId: 'tc-x', currentToolchainId: 'tc-x' });
    const d = _drsd(m14([same], ['TOOLCHAIN_PROVENANCE_UNVERIFIED']));
    expect(d.unsignableReasons).toContain('TOOLCHAIN_PROVENANCE_UNVERIFIED');
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('★Codex 复审致命 1：PASS 报告**删除** toolchain pair（字段全缺）仍 UNSIGNABLE（不能删字段洗白）', () => {
    const noPair = crossToolchainCase({ baselineToolchainId: undefined, currentToolchainId: undefined });
    const d = _drsd(m14([noPair], ['TOOLCHAIN_PROVENANCE_UNVERIFIED']));
    expect(d.unsignableReasons).toContain('TOOLCHAIN_PROVENANCE_UNVERIFIED');
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('★致命防线：m1.4 报告漏报 provenance reason（伪造空 reasons 假装可签字）→ fail-closed UNSIGNABLE', () => {
    // 报告有跨 toolchain 证据（派生应含 provenance），但顶层声明 reasons=[] → 声明与事实矛盾。
    const lying = m14([crossToolchainCase()], []); // 顶层 reasons 空但事实有 provenance
    const d = _drsd(lying);
    expect(d.declaredConsistent).toBe(false);
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('★历史 m1.3 PASS 报告（有跨 toolchain 证据）→ 现按版本政策派生 provenance → UNSIGNABLE（有意语义收紧）', () => {
    // Item 4 F 前 m1.3 跨升级 PASS 是 SIGNABLE；现诚实降级（provenance 未验证）。
    const m13 = { ...fixedReportBody('p0a-runner/m1.3'), cases: [crossToolchainCase()], signability: 'SIGNABLE' as const, unsignableLegacyCases: 0 };
    const d = _drsd(m13);
    expect(d.unsignableReasons).toContain('TOOLCHAIN_PROVENANCE_UNVERIFIED');
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('★legacy + provenance 双原因并存（reasons 集去重+canonical 排序）', () => {
    const d = _drsd(m14([crossToolchainCase({ caseHashVersion: CASE_HASH_VERSION_M10 })],
      ['LEGACY_CASE_HASH_VERSION', 'TOOLCHAIN_PROVENANCE_UNVERIFIED'], 1));
    // canonical 顺序：LEGACY 在 TOOLCHAIN 前。
    expect(d.unsignableReasons).toEqual(['LEGACY_CASE_HASH_VERSION', 'TOOLCHAIN_PROVENANCE_UNVERIFIED']);
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('assembleReport 产 m1.5 报告 + unsignableReasons（含 provenance）+ transition 证据默认 null', () => {
    const cases: CaseCoverageMeta[] = [
      { id: 'c1', expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] },
      { id: 'c2', expectedDecision: 'approved', sourceKind: 'execution', coverageTags: [] },
      { id: 'c3', expectedDecision: 'denied', sourceKind: 'execution', coverageTags: [] },
      { id: 'c4', expectedDecision: 'denied', sourceKind: 'handwritten', coverageTags: ['boundary'] },
    ];
    const details: CaseRunDetail[] = cases.map((c) => ({
      caseId: c.id, status: 'PASS', caseHash: `${c.id}-h`, caseHashVersion: CASE_HASH_VERSION,
      functionName: 'f', locale: 'en-US', coverageTags: c.coverageTags, sourceKind: c.sourceKind,
      expectedOutputHash: 'h', actualOutputHash: 'h', baselineToolchainId: 'tc-base', currentToolchainId: 'tc-cur',
    }));
    const r = assemble(cases, details);
    // ★S1：新 run 产 m1.5 报告；transition 证据默认 null（manifest 由后续独立批准流程附加）。
    expect(r.runnerVersion).toBe('p0a-runner/m1.5');
    expect(r.approvedTransitionManifestHash).toBeNull();
    expect(r.transitionVerified).toBeNull();
    expect(r.unsignableReasons).toContain('TOOLCHAIN_PROVENANCE_UNVERIFIED');
    // 有 provenance reason → 该 PASS 报告不可签字通过。
    expect(isSignablePass(r)).toBe(false);
  });

  it('★Codex 复审致命 1：OUTPUT_HASH_MISMATCH drift **删除** toolchain pair 仍派生 provenance（不可删字段洗白可审批漂移）', () => {
    // FAIL_REGRESSION + 可审批的 OUTPUT_HASH_MISMATCH = 声称「升级后输出漂移」（跨升级语义）。攻击者删 toolchain
    // pair 想消除 provenance reason → 派生由 case.status/reason 事实判定，删字段无效，reason 仍在。
    const drift = crossToolchainCase({
      status: 'FAIL_REGRESSION', reason: 'OUTPUT_HASH_MISMATCH',
      expectedOutputHash: 'b1', actualOutputHash: 'n1',
      baselineToolchainId: undefined, currentToolchainId: undefined,
    });
    const d = _drsd(m14([drift], ['TOOLCHAIN_PROVENANCE_UNVERIFIED']));
    expect(d.unsignableReasons).toContain('TOOLCHAIN_PROVENANCE_UNVERIFIED');
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('★Codex 复审致命 2：m1.4 顶层含**未知** reason → computeReportHash **throw**（非静默过滤——防 [] 与 ["FORGED"] 同 hash）', () => {
    const forged = {
      ...fixedReportBody('p0a-runner/m1.4'),
      unsignableReasons: ['FORGED_REASON' as unknown as _UR],
    };
    expect(() => computeReportHash(forged)).toThrow(/unsupported unsignableReason/);
  });

  it('★Codex 复审致命 2：m1.4 顶层含未知 reason → declaredConsistent=false → fail-closed UNSIGNABLE（不先过滤再比）', () => {
    // 报告事实为 PASS（派生 reasons=[TOOLCHAIN_PROVENANCE_UNVERIFIED]），但顶层注入未知 reason → 声明结构损坏。
    const injected = {
      ...fixedReportBody('p0a-runner/m1.4'),
      cases: [crossToolchainCase()],
      signability: 'UNSIGNABLE' as const,
      unsignableReasons: ['FORGED_REASON' as unknown as _UR],
      unsignableLegacyCases: 0,
    };
    const d = _drsd(injected);
    expect(d.declaredConsistent).toBe(false);
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('★Codex 复审致命 2：m1.4 顶层 reasons **重复/非 canonical 排序** → declaredConsistent=false（严格一致，不宽容归一）', () => {
    // 事实派生 = ['LEGACY_CASE_HASH_VERSION','TOOLCHAIN_PROVENANCE_UNVERIFIED']（canonical）；顶层给逆序 → 结构损坏。
    const nonCanonical = {
      ...fixedReportBody('p0a-runner/m1.4'),
      cases: [crossToolchainCase({ caseHashVersion: CASE_HASH_VERSION_M10 })],
      signability: 'UNSIGNABLE' as const,
      unsignableReasons: ['TOOLCHAIN_PROVENANCE_UNVERIFIED', 'LEGACY_CASE_HASH_VERSION'] as _UR[],
      unsignableLegacyCases: 1,
    };
    const d = _drsd(nonCanonical);
    expect(d.declaredConsistent).toBe(false);
    expect(d.signability).toBe('UNSIGNABLE');
  });

  // ── isDriftApprovable：写/读共用的受控接受准入门（Codex 复审 P0：防写路径与读路径双口径）──

  it('★Codex 复审 P0：provenance-only 报告（golden 干净）isDriftApprovable=true——provenance 缺失不阻断审批', () => {
    // m1.4 OUTPUT_HASH_MISMATCH drift：派生 reasons=[TOOLCHAIN_PROVENANCE_UNVERIFIED]，全维度 UNSIGNABLE，
    // 但 golden 完整性维度干净 → 可受控接受（否则整个受控接受功能在正常 API 全废=破坏性回归）。
    const drift = crossToolchainCase({
      status: 'FAIL_REGRESSION', reason: 'OUTPUT_HASH_MISMATCH', expectedOutputHash: 'b1', actualOutputHash: 'n1',
    });
    const report = m14([drift], ['TOOLCHAIN_PROVENANCE_UNVERIFIED']);
    expect(_drsd(report).goldenIntegritySignable).toBe(true);
    expect(isDriftApprovable(report)).toBe(true); // provenance 不阻断
    expect(_drsd(report).signability).toBe('UNSIGNABLE'); // 但全维度仍不可签字（provenance）
  });

  it('★golden 完整性门：legacy（m1.0 弱绑定）drift → isDriftApprovable=false（golden 无法证明，拒审批）', () => {
    const drift = crossToolchainCase({
      status: 'FAIL_REGRESSION', reason: 'OUTPUT_HASH_MISMATCH', expectedOutputHash: 'b1', actualOutputHash: 'n1',
      caseHashVersion: CASE_HASH_VERSION_M10,
    });
    const report = m14([drift], ['LEGACY_CASE_HASH_VERSION', 'TOOLCHAIN_PROVENANCE_UNVERIFIED'], 1);
    expect(isDriftApprovable(report)).toBe(false); // legacy 维度拦
  });

  it('★golden 完整性门：无 golden 承诺（m1.0 runner）→ isDriftApprovable=false', () => {
    // m1.0 报告无 golden 承诺 → GOLDEN_COMMITMENT_UNSUPPORTED → golden 完整性不可信 → 拒审批。
    const drift = crossToolchainCase({
      status: 'FAIL_REGRESSION', reason: 'OUTPUT_HASH_MISMATCH', expectedOutputHash: 'b1', actualOutputHash: 'n1',
    });
    const m10Report = { ...fixedReportBody('p0a-runner/m1.0'), status: 'FAIL_REGRESSION' as const, cases: [drift] };
    expect(_drsd(m10Report).unsignableReasons).toContain('GOLDEN_COMMITMENT_UNSUPPORTED');
    expect(isDriftApprovable(m10Report)).toBe(false);
  });

  it('★声明不自洽（m1.4 顶层伪造）→ isDriftApprovable=false（fail-closed，即便 golden 派生干净）', () => {
    // 顶层注入未知 reason → declaredConsistent=false → goldenIntegritySignable=false（不能因派生 golden 干净放行）。
    const drift = crossToolchainCase({
      status: 'FAIL_REGRESSION', reason: 'OUTPUT_HASH_MISMATCH', expectedOutputHash: 'b1', actualOutputHash: 'n1',
    });
    const forged = {
      ...fixedReportBody('p0a-runner/m1.4'),
      cases: [drift],
      signability: 'UNSIGNABLE' as const,
      unsignableReasons: ['FORGED_REASON' as unknown as _UR],
      unsignableLegacyCases: 0,
    };
    expect(_drsd(forged).declaredConsistent).toBe(false);
    expect(isDriftApprovable(forged)).toBe(false);
  });
});

// ============ P0-A S1（m1.5）：已批准升级证据（层5）——★铁律：携证据报告仍 UNSIGNABLE ============

describe('P0-A S1 — m1.5 transition 证据（层5，不解锁签字）', () => {
  // m1.5 报告基体：cross-toolchain PASS（派生 provenance）+ 携 transition 证据。
  const m15Base = () => ({
    ...fixedReportBody('p0a-runner/m1.5'),
    signability: 'UNSIGNABLE' as const,
    unsignableReasons: ['TOOLCHAIN_PROVENANCE_UNVERIFIED'] as _UR[],
  });

  it('★铁律：m1.5 报告**携已验签 transition 证据**仍派生 UNSIGNABLE（层5≠层3，provenance 未验证）', () => {
    // manifest 已验签（transitionVerified=true）也**不**移除 TOOLCHAIN_PROVENANCE_UNVERIFIED。
    const withEvidence = {
      ...m15Base(),
      approvedTransitionManifestHash: 'mh-abc',
      transitionVerified: true,
    };
    const d = _drsd(withEvidence);
    expect(d.unsignableReasons).toContain('TOOLCHAIN_PROVENANCE_UNVERIFIED');
    expect(d.signability).toBe('UNSIGNABLE');
    // isSignablePass 恒 false（status===PASS 但 provenance 未验证）——携 manifest 不改变。
    expect(isSignablePass({ ...withEvidence, status: 'PASS' })).toBe(false);
  });

  it('★m1.5 golden 向量冻结 + transition 证据**不进** hash（Codex 复审 P1-4：证据是报告外可撤销 artifact）', () => {
    const base = {
      status: 'PASS' as const, comparisonMode: 'FROZEN_BASELINE_VS_CURRENT_BACKEND' as const,
      baselineSemantics: 'sem', policyId: 'pol-1', policyVersionRowId: 'pv-1', currentRuntimeToolchainId: 'tc-cur',
      coverage: { totalCases: 1, runnableCases: 1, approvedCases: 1, deniedCases: 0, handwrittenBoundaryCases: 1,
        thresholds: { minRunnableCases: 1, minApprovedCases: 1, minDeniedCases: 0, minHandwrittenBoundaryCases: 1 }, unmet: [] },
      summary: { passed: 1, failed: 0, nonReplayable: 0, compileFailures: 0 },
      cases: [{ caseId: 'c1', status: 'PASS' as const, caseHash: 'CASEHASH-1', caseHashVersion: 'case-hash/m1.1',
        functionName: 'greet', locale: 'en-US', coverageTags: ['boundary'], sourceKind: 'execution' as const,
        expectedInputHash: 'ei1', actualInputHash: 'ai1', expectedOutputHash: 'eo1', actualOutputHash: 'ao1',
        baselineToolchainId: 'tc-base', currentToolchainId: 'tc-cur' }],
      runnerVersion: 'p0a-runner/m1.5' as const, signability: 'UNSIGNABLE' as const, unsignableLegacyCases: 0,
      unsignableReasons: ['TOOLCHAIN_PROVENANCE_UNVERIFIED'] as _UR[],
    };
    // 冻结向量。
    const V = 'f7fda1d254657b40af153cd662eac8d78d97c5c1480b6dc05fcd70c099221f8e';
    expect(computeReportHash({ ...base })).toBe(V);
    // ★transition 证据字段**不影响** hash（携证据/不携证据同 hash）——证据由独立 manifest 表派生，报告 hash
    // 不承诺可撤销的事后 artifact。
    expect(computeReportHash({ ...base, approvedTransitionManifestHash: 'mh-abc', transitionVerified: true })).toBe(V);
    expect(computeReportHash({ ...base, approvedTransitionManifestHash: null, transitionVerified: null })).toBe(V);
    // m1.5 与 m1.4 结构相同仅版本串不同 → 不同 hash（正常）。
    expect(computeReportHash({ ...base, runnerVersion: 'p0a-runner/m1.4' })).not.toBe(V);
  });

  it('★Codex 复审 P1-1：m1.5 lying artifact——声明 SIGNABLE+空 reasons 但 cases 派生 UNSIGNABLE → declaredConsistent=false', () => {
    // m1.5 须与 m1.4 共用严格声明一致性（否则落旧默认分支 declaredConsistent 恒 true = lying artifact 漏网）。
    const base = fixedReportBody('p0a-runner/m1.5');
    const lying = {
      ...base,
      status: 'PASS' as const,
      signability: 'SIGNABLE' as const, // 谎称可签字
      unsignableReasons: [] as _UR[], // 谎称空 reasons
      unsignableLegacyCases: 0,
    };
    const d = _drsd(lying);
    expect(d.declaredConsistent).toBe(false); // 派生事实 = UNSIGNABLE(provenance)，与声明矛盾 → fail-closed
    expect(d.signability).toBe('UNSIGNABLE');
  });

  it('★assembleReport 新 run 产 m1.5 + transition 证据默认 null', () => {
    const { cases, details } = coverageSatisfyingCases();
    const r = assemble(cases, details);
    expect(r.runnerVersion).toBe('p0a-runner/m1.5');
    expect(r.approvedTransitionManifestHash).toBeNull();
    expect(r.transitionVerified).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import {
  assembleReport,
  computeCaseHash,
  computeReportHash,
  DEFAULT_THRESHOLDS,
  COMPARISON_MODE_FROZEN_BASELINE,
  type CaseCoverageMeta,
  type CaseRunDetail,
  type CoverageThresholds,
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

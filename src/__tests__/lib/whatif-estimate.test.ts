// What-if 估算测试（Phase 4）。
//
// 这个模块最大的风险不是算错，而是**把不确定的东西说得太确定**。
// 故重点断言"没数据时不给结论"：null ≠ 0、样本不足要降置信度、假设必须随结果返回。

import { describe, it, expect } from 'vitest';
import {
  estimateWhatIf,
  type OutcomeSample,
} from '@/lib/analytics/whatif-estimate';

const OPTS = {
  positiveOutcomes: ['converted'],
  negativeOutcomes: ['defaulted'],
  approveDecisions: ['APPROVED'],
};

const s = (
  id: string,
  decision: string,
  outcome: string | null = null,
  value: number | null = null,
): OutcomeSample => ({ executionId: id, decision, outcome, value });

describe('estimateWhatIf', () => {
  it('空样本 → 不给结论', () => {
    const e = estimateWhatIf([], new Map(), OPTS);
    expect(e.sampleSize).toBe(0);
    expect(e.confidence).toBe('insufficient');
    expect(e.estimatedValueDelta).toBeNull();
    expect(e.caveats).toContain('NO_OUTCOME_DATA');
  });

  it('统计决策变化的方向', () => {
    const e = estimateWhatIf(
      [s('1', 'REJECTED'), s('2', 'APPROVED'), s('3', 'APPROVED')],
      new Map([
        ['1', 'APPROVED'], // 新增放行
        ['2', 'REJECTED'], // 新增拒绝
      ]),
      OPTS,
    );
    expect(e.changed).toBe(2);
    expect(e.newlyApproved).toBe(1);
    expect(e.newlyRejected).toBe(1);
  });

  it('★基线只用历史放行样本（被拒绝的没有结局可言）', () => {
    const e = estimateWhatIf(
      [
        s('1', 'APPROVED', 'converted'),
        s('2', 'APPROVED', 'defaulted'),
        // 被拒绝的即便有 outcome 也不该进基线分母，否则系统性低估正面率
        s('3', 'REJECTED', 'defaulted'),
        s('4', 'REJECTED', 'defaulted'),
      ],
      new Map(),
      OPTS,
    );
    expect(e.baselinePositiveRate).toBe(0.5); // 1/2，不是 1/4
  });

  // ★核心诚实性：没数据 ≠ 没变化
  it('★无金额数据时 estimatedValueDelta 为 null 而非 0', () => {
    const e = estimateWhatIf(
      [s('1', 'APPROVED', 'converted'), s('2', 'REJECTED')],
      new Map([['2', 'APPROVED']]),
      OPTS,
    );
    expect(e.baselineAvgValue).toBeNull();
    expect(e.estimatedValueDelta).toBeNull();
    expect(e.estimatedValueDelta).not.toBe(0);
    expect(e.caveats).toContain('NO_VALUE_DATA');
  });

  it('有金额基线时按新增放行净额估算', () => {
    const samples = [
      s('1', 'APPROVED', 'converted', 100),
      s('2', 'APPROVED', 'converted', 200),
      s('3', 'REJECTED'),
    ];
    const e = estimateWhatIf(samples, new Map([['3', 'APPROVED']]), OPTS);
    expect(e.baselineAvgValue).toBe(150);
    expect(e.newlyApproved).toBe(1);
    expect(e.estimatedValueDelta).toBe(150);
  });

  it('新增拒绝产生负向估计', () => {
    const samples = [
      s('1', 'APPROVED', 'converted', 100),
      s('2', 'APPROVED', 'converted', 100),
    ];
    const e = estimateWhatIf(samples, new Map([['2', 'REJECTED']]), OPTS);
    expect(e.estimatedValueDelta).toBe(-100);
  });

  it('★样本不足时置信度为 insufficient', () => {
    const few = Array.from({ length: 5 }, (_, i) => s(String(i), 'APPROVED', 'converted', 10));
    const e = estimateWhatIf(few, new Map(), OPTS);
    expect(e.confidence).toBe('insufficient');
    expect(e.caveats).toContain('SAMPLE_TOO_SMALL');
  });

  it('样本足够时升到 low / moderate', () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => s(String(i), 'APPROVED', 'converted', 10));
    expect(estimateWhatIf(mk(50), new Map(), OPTS).confidence).toBe('low');
    expect(estimateWhatIf(mk(250), new Map(), OPTS).confidence).toBe('moderate');
  });

  it('★假设说明必须随结果返回（不能只给数字）', () => {
    const e = estimateWhatIf([], new Map(), OPTS);
    expect(e.assumption).toBeTruthy();
    expect(e.assumption).toContain('估算');
  });

  it('未回传 outcome 的样本不计入 withOutcome', () => {
    const e = estimateWhatIf(
      [s('1', 'APPROVED', 'converted'), s('2', 'APPROVED', null)],
      new Map(),
      OPTS,
    );
    expect(e.sampleSize).toBe(2);
    expect(e.withOutcome).toBe(1);
  });

  it('中性结局计入分母但不计正面分子', () => {
    const e = estimateWhatIf(
      [
        s('1', 'APPROVED', 'converted'),
        s('2', 'APPROVED', 'pending'), // 既非正也非负
      ],
      new Map(),
      OPTS,
    );
    expect(e.baselinePositiveRate).toBe(0.5);
  });

  it('新决策缺失时视为不变（不当作拒绝）', () => {
    const e = estimateWhatIf([s('1', 'APPROVED', 'converted', 10)], new Map(), OPTS);
    expect(e.changed).toBe(0);
    expect(e.newlyRejected).toBe(0);
  });

  it('非有限 value 被忽略而非污染均值', () => {
    const e = estimateWhatIf(
      [
        s('1', 'APPROVED', 'converted', 100),
        s('2', 'APPROVED', 'converted', Number.NaN),
      ],
      new Map(),
      OPTS,
    );
    expect(e.baselineAvgValue).toBe(100);
  });
});

  // ★P1 回归：置信度必须按驱动估算的样本量判定，不是结局总数。
  //
  // 估算的两个输出都只从「原本通过且有结局」的样本算出，与被拒样本无关。
  // 原实现按 withOutcome 判定，1 条相关基线 + 199 条无关被拒 → 报 moderate。
  describe('★置信度：类别失衡不得虚高', () => {
    it('1 条通过 + 199 条被拒 不得报 moderate', () => {
      const samples = [
        s('a', 'APPROVED', 'converted', 100),
        ...Array.from({ length: 199 }, (_, i) =>
          s('r' + i, 'REJECTED', 'defaulted', 0)),
      ];
      const e = estimateWhatIf(samples, new Map(), OPTS);
      expect(e.confidence).toBe('insufficient');
      expect(e.caveats).toContain('BASELINE_TOO_SMALL');
    });

    it('相关基线充足时仍应升到 moderate（不能矫枉过正）', () => {
      const samples = Array.from({ length: 250 }, (_, i) =>
        s(String(i), 'APPROVED', 'converted', 10));
      const e = estimateWhatIf(samples, new Map(), OPTS);
      expect(e.confidence).toBe('moderate');
      expect(e.caveats).not.toContain('BASELINE_TOO_SMALL');
    });
  });

  // ★第二轮审查：金额估算与正面率样本量可能差很远，不得共用一档置信度。
  describe('★金额置信度独立于正面率', () => {
    it('250 条结局但仅 1 条带金额 → 金额置信度不得为 moderate', () => {
      const samples = [
        s('v0', 'APPROVED', 'converted', 100),
        ...Array.from({ length: 249 }, (_, i) =>
          s('n' + i, 'APPROVED', 'converted', null)),
      ];
      const e = estimateWhatIf(samples, new Map(), OPTS);
      expect(e.confidence).toBe('moderate');          // 正面率样本充足
      expect(e.valueConfidence).toBe('insufficient'); // 金额只有 1 条
      expect(e.caveats).toContain('VALUE_SAMPLE_TOO_SMALL');
    });

    it('金额样本同样充足时两档都是 moderate', () => {
      const samples = Array.from({ length: 250 }, (_, i) =>
        s(String(i), 'APPROVED', 'converted', 10));
      const e = estimateWhatIf(samples, new Map(), OPTS);
      expect(e.confidence).toBe('moderate');
      expect(e.valueConfidence).toBe('moderate');
      expect(e.caveats).not.toContain('VALUE_SAMPLE_TOO_SMALL');
    });

    it('无金额数据时金额置信度为 insufficient（与 delta 返回 null 对齐）', () => {
      const samples = Array.from({ length: 250 }, (_, i) =>
        s(String(i), 'APPROVED', 'converted', null));
      const e = estimateWhatIf(samples, new Map(), OPTS);
      expect(e.estimatedValueDelta).toBeNull();
      expect(e.valueConfidence).toBe('insufficient');
    });
  });

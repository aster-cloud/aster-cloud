/**
 * 确定性解释 buildExplanation 的值正确性契约。
 *
 * 此前 AI 解释依赖 LLM 引用 trace 数值 → 模型吐空值模板。改为确定性渲染后，
 * 解释里的每个值必须精确等于规则/阈值/申请人算出的真值。本测试钉住：字段实际值、
 * 中间指标计算、档位短路（已返回的后续档位不求值）、一句话原因含真实数字。
 */
import { describe, it, expect } from 'vitest';
import {
  buildExplanation, DEFAULT_THRESHOLDS, DEMO_APPLICANTS, type DemoLocale,
} from '@/config/credit-risk-demo';

describe('buildExplanation: deterministic, value-exact', () => {
  for (const loc of ['en', 'zh', 'de'] as DemoLocale[]) {
    it(`${loc}: premium applicant — exact field values + metrics + short-circuit`, () => {
      const app = DEMO_APPLICANTS.approved; // 768 / 9200 / 2760 / 240000
      const e = buildExplanation(loc, app, DEFAULT_THRESHOLDS);

      // 字段实际值精确（按声明顺序：score/income/debt/amount）。
      expect(e.fields.map((f) => f.value)).toEqual(['768', '9200', '2760', '240000']);
      // 字段都有非空用途（不留模板空白）。
      expect(e.fields.every((f) => f.purpose.length > 0)).toBe(true);

      // 中间指标计算精确：DTI=2760/9200=0.30，可负担上限=9200×12×5=552000。
      const dti = e.metrics.find((m) => m.computation.includes('2760'));
      expect(dti?.computation).toBe('2760 ÷ 9200');
      expect(dti?.result).toBe('0.30');
      const cap = e.metrics.find((m) => m.computation.includes('× 12'));
      expect(cap?.computation).toBe('9200 × 12 × 5');
      expect(cap?.result).toBe('552000');

      // premium 命中 → 后续档位短路（不求值）。
      expect(e.tiers[0].evaluated).toBe(true);
      expect(e.tiers[0].matched).toBe(true);
      expect(e.tiers.slice(1).every((tr) => tr.evaluated === false && tr.matched === null)).toBe(true);

      // 一句话原因含真实数字。
      expect(e.oneLineReason).toContain('768');
      expect(e.oneLineReason).toContain('240000');
      expect(e.oneLineReason).toContain('552000');
      // 决策 = premium。
      expect(e.outcome).toBe('approved');
    });

    it(`${loc}: oversized amount — refer with amount reason citing real cap`, () => {
      const app = { ...DEMO_APPLICANTS.approved, requestedAmount: 900000 }; // > cap 552000
      const e = buildExplanation(loc, app, DEFAULT_THRESHOLDS);
      expect(e.outcome).toBe('refer');
      // premium/standard 求值且不满足（额度超上限）；refer 求值且满足。
      expect(e.tiers[0].evaluated && e.tiers[0].matched === false).toBe(true);
      // 一句话原因引用真实额度与上限。
      expect(e.oneLineReason).toContain('900000');
      expect(e.oneLineReason).toContain('552000');
    });

    it(`${loc}: declined applicant — declined with min-score reason`, () => {
      const e = buildExplanation(loc, DEMO_APPLICANTS.declined, DEFAULT_THRESHOLDS); // 561
      expect(e.outcome).toBe('declined');
      expect(e.oneLineReason).toContain('561');
      expect(e.oneLineReason).toContain('600'); // minScore
    });
  }
});

// 防回归：Bug-4（Execute Policy UI Decision 显示错）的核心字段识别
//
// 历史 bug：UI 在 evaluate-source 路径用 Boolean(整个 result 对象) 判断 approved；
//          且 cnl-executor.parseApprovalFromResult 的 approvalFields 列表缺
//          isEligible/eligible，导致 EligibilityResult{isEligible:false} 落入
//          _type 分支被判 approved=true。
//
// 修复方向：approvalFields 必须包含 isEligible/eligible/allowed/isAllowed/...
//          覆盖常见 policy 决策字段，保持英中德三语对齐。

import { describe, it, expect } from 'vitest';
import { parseApprovalFromResult } from '@/services/policy/cnl-executor';

describe('parseApprovalFromResult — 决策字段识别', () => {
  describe('Bug-4 核心字段：isEligible / eligible', () => {
    it('isEligible: false → approved: false（loan eligibility）', () => {
      const r = parseApprovalFromResult({
        _type: 'EligibilityResult',
        isEligible: false,
        reason: 'Applicant is under minimum age requirement',
      });
      expect(r.approved).toBe(false);
      expect(r.message).toContain('under minimum');
    });

    it('isEligible: true → approved: true', () => {
      const r = parseApprovalFromResult({
        _type: 'EligibilityResult',
        isEligible: true,
        reason: 'Applicant meets minimum age requirement',
      });
      expect(r.approved).toBe(true);
    });

    it('eligible: false（不带 is 前缀）→ approved: false', () => {
      const r = parseApprovalFromResult({ eligible: false, reason: 'rejected' });
      expect(r.approved).toBe(false);
    });
  });

  describe('其他批准字段', () => {
    it('approved: true', () => {
      expect(parseApprovalFromResult({ approved: true }).approved).toBe(true);
    });

    it('isApproved: false', () => {
      expect(parseApprovalFromResult({ isApproved: false }).approved).toBe(false);
    });

    it('allowed: true', () => {
      expect(parseApprovalFromResult({ allowed: true, reason: 'ok' }).approved).toBe(true);
    });

    it('isAllowed: false', () => {
      expect(parseApprovalFromResult({ isAllowed: false }).approved).toBe(false);
    });

    it('isSuccess: true', () => {
      expect(parseApprovalFromResult({ isSuccess: true }).approved).toBe(true);
    });

    it('success: false', () => {
      expect(parseApprovalFromResult({ success: false }).approved).toBe(false);
    });

    it('中文 "批准": true', () => {
      expect(parseApprovalFromResult({ '批准': true }).approved).toBe(true);
    });

    it('德文 "genehmigt": false', () => {
      expect(parseApprovalFromResult({ genehmigt: false }).approved).toBe(false);
    });
  });

  describe('字段优先级', () => {
    it('approved 优先于 _type fallback', () => {
      const r = parseApprovalFromResult({
        _type: 'Result',
        approved: false,
      });
      expect(r.approved).toBe(false);
    });

    it('isEligible: false 不会被 _type fallback 覆盖（Bug-4 反例）', () => {
      // 历史 bug：含 _type 的对象直接 approved:true，忽略 isEligible
      const r = parseApprovalFromResult({
        _type: 'EligibilityResult',
        isEligible: false,
      });
      expect(r.approved).toBe(false);
    });
  });

  describe('Fallback 行为', () => {
    it('只有 _type 没有决策字段 → approved: true（兼容已有计算结果）', () => {
      expect(parseApprovalFromResult({ _type: 'CalcResult', value: 42 }).approved).toBe(true);
    });

    it('只有 value 字段 → approved: true（计算类）', () => {
      expect(parseApprovalFromResult({ result: 100, message: 'ok' }).approved).toBe(true);
    });

    it('null → approved: false', () => {
      expect(parseApprovalFromResult(null).approved).toBe(false);
    });

    it('undefined → approved: false', () => {
      expect(parseApprovalFromResult(undefined).approved).toBe(false);
    });
  });

  describe('字符串结果（非对象）', () => {
    it('"approved" 关键词', () => {
      expect(parseApprovalFromResult('approved by all rules').approved).toBe(true);
    });

    it('"denied" 关键词', () => {
      expect(parseApprovalFromResult('denied: insufficient credit').approved).toBe(false);
    });
  });

  // 本地化布尔字面量：CNL 引擎执行后 Bool 字段保留本地化字符串（真/wahr），
  // 而非统一 JS boolean。此前真值判断只认 true/'true' → 中文/德文 Bool 被误判
  // false，「批准=真、信用良好」却落入 deniedReasons（用户反馈的违反直觉案例）。
  describe('本地化布尔值（zh 真/假 · de wahr/falsch）', () => {
    it('中文：批准="真" + 理由="信用良好" → approved: true（不进 deniedReasons）', () => {
      const r = parseApprovalFromResult({
        _type: '决定',
        批准: '真',
        利率: 450,
        理由: '信用良好',
      });
      expect(r.approved).toBe(true);
      expect(r.message).toBe('信用良好');
    });

    it('中文：批准="假" + 理由="信用评分过低" → approved: false', () => {
      const r = parseApprovalFromResult({
        _type: '决定',
        批准: '假',
        理由: '信用评分过低',
      });
      expect(r.approved).toBe(false);
      expect(r.message).toBe('信用评分过低');
    });

    it('德文：genehmigt="wahr" → approved: true', () => {
      const r = parseApprovalFromResult({
        _type: 'Entscheidung',
        genehmigt: 'wahr',
        begruendung: 'Gute Bonitaet',
      });
      expect(r.approved).toBe(true);
    });

    it('德文：genehmigt="falsch" → approved: false', () => {
      const r = parseApprovalFromResult({
        genehmigt: 'falsch',
        begruendung: 'Bonitaet zu niedrig',
      });
      expect(r.approved).toBe(false);
    });

    it('英文 boolean true/"true" 仍正确（无回归）', () => {
      expect(parseApprovalFromResult({ approved: true, reason: 'ok' }).approved).toBe(true);
      expect(parseApprovalFromResult({ approved: 'true', reason: 'ok' }).approved).toBe(true);
    });
  });
});

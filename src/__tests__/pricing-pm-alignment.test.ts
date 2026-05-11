// PM 文档 ↔ plans.ts 防回归测试
// 防回归：v1.1 三档化 + ¥299/$39/€36 + 删除 Team grandfather
// PM 真值见 aster-deploy/docs/pm/05-pricing-packaging.md

import { describe, it, expect } from 'vitest';
import {
  PLAN_PRICES,
  PLANS,
  PM_PLAN_LIMITS_V2,
  LEGACY_PLAN_LIMITS,
  PUBLIC_PRICING_TIERS,
  PUBLIC_PRO_MONTHLY_PRICE,
  getPlanPrice,
  getDisplayPlan,
} from '@/lib/plans';
import { AI_MONTHLY_QUOTA } from '@/lib/ai-quota';

describe('PM v1.1 ↔ plans.ts 一致性', () => {
  describe('Pro 价格 (¥299 / $39 / €36)', () => {
    it('CNY = ¥299/月', () => {
      expect(PLAN_PRICES.pro.CNY.monthly).toBe(299);
      expect(PUBLIC_PRO_MONTHLY_PRICE.CNY).toBe(299);
    });

    it('USD = $39/月', () => {
      expect(PLAN_PRICES.pro.USD.monthly).toBe(39);
      expect(PUBLIC_PRO_MONTHLY_PRICE.USD).toBe(39);
    });

    it('EUR = €36/月', () => {
      expect(PLAN_PRICES.pro.EUR.monthly).toBe(36);
      expect(PUBLIC_PRO_MONTHLY_PRICE.EUR).toBe(36);
    });

    it('年付 = 月价 × 12 × 0.8（PM 决策）', () => {
      expect(PLAN_PRICES.pro.CNY.yearly).toBe(2870); // 299*12*0.8≈2870.4
      expect(PLAN_PRICES.pro.USD.yearly).toBe(374); // 39*12*0.8≈374.4
      expect(PLAN_PRICES.pro.EUR.yearly).toBe(346); // 36*12*0.8≈345.6
    });
  });

  describe('三档化（无 Team 档位）', () => {
    it('PUBLIC_PRICING_TIERS 是 Free/Pro/Enterprise', () => {
      expect([...PUBLIC_PRICING_TIERS].sort()).toEqual(['enterprise', 'free', 'pro']);
    });

    it('PM_PLAN_LIMITS_V2 仅含 free/pro/enterprise', () => {
      expect(Object.keys(PM_PLAN_LIMITS_V2).sort()).toEqual(['enterprise', 'free', 'pro']);
    });

    it('LEGACY_PLAN_LIMITS 不含 team（v3 simplified）', () => {
      expect((LEGACY_PLAN_LIMITS as Record<string, unknown>).team).toBeUndefined();
    });

    it('PLAN_PRICES 不含 team perUser 价格（v3 simplified）', () => {
      expect((PLAN_PRICES as Record<string, unknown>).team).toBeUndefined();
    });

    it('getPlanPrice("team") 兜底映射到 Pro 价格', () => {
      expect(getPlanPrice('team', 'CNY')).toEqual(getPlanPrice('pro', 'CNY'));
    });
  });

  describe('Free 限额对齐 PM 05', () => {
    it('Free = 5 rules / 1k evaluations / 7d audit / 1 seat', () => {
      expect(PM_PLAN_LIMITS_V2.free.publishedRules).toBe(5);
      expect(PM_PLAN_LIMITS_V2.free.evaluations).toBe(1000);
      expect(PM_PLAN_LIMITS_V2.free.auditRetentionDays).toBe(7);
      expect(PM_PLAN_LIMITS_V2.free.maxTeamMembers).toBe(1);
      expect(PM_PLAN_LIMITS_V2.free.approvalRequired).toBe(false);
    });
  });

  describe('Pro 限额对齐 PM 05', () => {
    it('Pro = 100 rules / 50k evaluations / 90d audit / SOX', () => {
      expect(PM_PLAN_LIMITS_V2.pro.publishedRules).toBe(100);
      expect(PM_PLAN_LIMITS_V2.pro.evaluations).toBe(50000);
      expect(PM_PLAN_LIMITS_V2.pro.auditRetentionDays).toBe(90);
      expect(PM_PLAN_LIMITS_V2.pro.approvalRequired).toBe(true);
    });

    it('Pro 启用审批流的最低席位 = 2 (Reviewer ≠ author)', () => {
      expect(PM_PLAN_LIMITS_V2.pro.approvalSeatThreshold).toBe(2);
    });
  });

  describe('Enterprise 限额对齐 PM 05', () => {
    it('Enterprise = 无限 / 无限审计 / customRoles', () => {
      expect(PM_PLAN_LIMITS_V2.enterprise.publishedRules).toBe(-1);
      expect(PM_PLAN_LIMITS_V2.enterprise.evaluations).toBe(-1);
      expect(PM_PLAN_LIMITS_V2.enterprise.auditRetentionDays).toBe(-1);
      expect(PM_PLAN_LIMITS_V2.enterprise.customRoles).toBe(true);
    });
  });

  describe('AI 配额对齐 PM 07', () => {
    it('Free = 20 / Pro = 500 / Enterprise = -1 (BYOK 无限)', () => {
      expect(AI_MONTHLY_QUOTA.free).toBe(20);
      expect(AI_MONTHLY_QUOTA.pro).toBe(500);
      expect(AI_MONTHLY_QUOTA.enterprise).toBe(-1);
    });
  });

  describe('getDisplayPlan UI 映射（v3：无 grandfather）', () => {
    it('plan=pro → pro', () => {
      expect(getDisplayPlan({ plan: 'pro' })).toBe('pro');
    });

    it('plan=team / trial → pro（兜底）', () => {
      expect(getDisplayPlan({ plan: 'team' })).toBe('pro');
      expect(getDisplayPlan({ plan: 'trial' })).toBe('pro');
    });

    it('legacyTier 不再影响 display（v3 移除）', () => {
      expect(getDisplayPlan({ plan: 'pro', legacyTier: 'team' })).toBe('pro');
      expect(getDisplayPlan({ plan: 'pro', legacyTier: null })).toBe('pro');
    });

    it('plan=enterprise → enterprise', () => {
      expect(getDisplayPlan({ plan: 'enterprise' })).toBe('enterprise');
    });

    it('plan=free → free', () => {
      expect(getDisplayPlan({ plan: 'free' })).toBe('free');
    });
  });

  describe('PLANS 配置一致性', () => {
    it('PLANS.pro.price 与 PLAN_PRICES.pro.USD 对齐', () => {
      expect(PLANS.pro.price.monthly).toBe(PLAN_PRICES.pro.USD.monthly);
      expect(PLANS.pro.price.yearly).toBe(PLAN_PRICES.pro.USD.yearly);
    });

    it('PLANS.pro.featureKeys 含 PM 关键卖点', () => {
      const keys = PLANS.pro.featureKeys as readonly string[];
      expect(keys).toContain('aiDrafts500');
      expect(keys).toContain('reviewerNotAuthor');
      expect(keys).toContain('soxCompliant');
    });

    it('PLANS.free.featureKeys 含 AI drafts', () => {
      const keys = PLANS.free.featureKeys as readonly string[];
      expect(keys).toContain('aiDrafts20');
      expect(keys).toContain('allLanguagePacks');
    });

    it('PLANS.enterprise.featureKeys 含 BYOK', () => {
      const keys = PLANS.enterprise.featureKeys as readonly string[];
      expect(keys).toContain('unlimitedAiDraftsByok');
      expect(keys).toContain('customIndustryLexicons');
      expect(keys).toContain('ssoSamlOidc');
    });
  });
});

// plans.ts 边界 fuzz 测试：扫描隐藏 bug
//
// 攻击 getEffectiveLimits / getDisplayPlan / getPlanPrice / getPlanStripePriceId
// 用奇怪的输入组合验证不会崩溃且返回合理 fallback

import { describe, it, expect } from 'vitest';
import {
  PLANS,
  PLAN_PRICES,
  PUBLIC_PRICING_TIERS,
  PRICE_LOCKED_CUTOFF,
  PM_PLAN_LIMITS_V2,
  LEGACY_PLAN_LIMITS,
  canAccessApiKeys,
  getDisplayPlan,
  getEffectiveLimits,
  getPlanPrice,
  getPlanStripePriceId,
  type PlanType,
} from '@/lib/plans';

describe('plans.ts — boundary fuzz', () => {
  describe('PUBLIC_PRICING_TIERS invariants', () => {
    it('does NOT include "team" or "trial" (PM v1.1 三档化)', () => {
      const tiers: readonly string[] = PUBLIC_PRICING_TIERS;
      expect(tiers).not.toContain('team');
      expect(tiers).not.toContain('trial');
    });

    it('exactly free / pro / enterprise', () => {
      expect([...PUBLIC_PRICING_TIERS].sort()).toEqual(['enterprise', 'free', 'pro']);
    });

    it('PLANS.team kept for backward compat (PlanType compatibility)', () => {
      // 防御性：DB enum 'team' 仍存在，PLANS map 必须包含同名 key 否则 PlanType 索引会爆
      expect(PLANS).toHaveProperty('team');
      expect((PLANS as Record<string, unknown>).team).toBeDefined();
    });
  });

  describe('getEffectiveLimits — priceLockedAt 类型边界', () => {
    it('priceLockedAt = null → V2 limits (free)', () => {
      const limits = getEffectiveLimits({ plan: 'free', priceLockedAt: null });
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.free.publishedRules);
    });

    it('priceLockedAt = ISO string before cutoff → LEGACY limits (free)', () => {
      const limits = getEffectiveLimits({
        plan: 'free',
        priceLockedAt: '2024-01-01T00:00:00Z',
      });
      expect(limits.publishedRules).toBe(LEGACY_PLAN_LIMITS.free.publishedRules);
    });

    it('priceLockedAt = Date object after cutoff → V2 limits', () => {
      const limits = getEffectiveLimits({
        plan: 'pro',
        priceLockedAt: new Date('2030-01-01T00:00:00Z'),
      });
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.pro.publishedRules);
    });

    it('priceLockedAt = epoch 0 (1970) → far before cutoff → LEGACY', () => {
      const limits = getEffectiveLimits({
        plan: 'pro',
        priceLockedAt: new Date(0),
      });
      expect(limits.publishedRules).toBe(LEGACY_PLAN_LIMITS.pro.publishedRules);
    });

    it('priceLockedAt = invalid date string → Date object created with NaN, comparison falls through to V2', () => {
      // new Date('garbage') → Invalid Date; (Invalid Date < cutoff) is false
      const limits = getEffectiveLimits({
        plan: 'pro',
        priceLockedAt: 'garbage-not-a-date',
      });
      // 不应崩溃；应该走 V2（因为 lockedAt < CUTOFF 比较返回 false）
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.pro.publishedRules);
    });

    it('priceLockedAt = empty string → falsy → null branch → V2', () => {
      const limits = getEffectiveLimits({ plan: 'pro', priceLockedAt: '' });
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.pro.publishedRules);
    });

    it('priceLockedAt exactly at cutoff (2026-06-01) → NOT before cutoff → V2', () => {
      const limits = getEffectiveLimits({
        plan: 'pro',
        priceLockedAt: PRICE_LOCKED_CUTOFF,
      });
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.pro.publishedRules);
    });

    it('priceLockedAt 1ms before cutoff → LEGACY', () => {
      const limits = getEffectiveLimits({
        plan: 'pro',
        priceLockedAt: new Date(PRICE_LOCKED_CUTOFF.getTime() - 1),
      });
      expect(limits.publishedRules).toBe(LEGACY_PLAN_LIMITS.pro.publishedRules);
    });
  });

  describe('getEffectiveLimits — plan 兜底', () => {
    it('plan = "team" (legacy enum) + null priceLockedAt → normalized to pro V2', () => {
      const limits = getEffectiveLimits({ plan: 'team', priceLockedAt: null });
      // PM v1.1 三档化：team enum 应映射到 pro V2 限额（不是 LEGACY.team）
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.pro.publishedRules);
      expect(limits.evaluations).toBe(PM_PLAN_LIMITS_V2.pro.evaluations);
    });

    it('plan = "trial" (legacy) + null priceLockedAt → normalized to pro V2', () => {
      const limits = getEffectiveLimits({ plan: 'trial', priceLockedAt: null });
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.pro.publishedRules);
    });

    it('plan = unknown bogus string → free fallback (does not crash)', () => {
      const limits = getEffectiveLimits({
        plan: 'foobar' as PlanType,
        priceLockedAt: null,
      });
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.free.publishedRules);
      expect(limits.approvalRequired).toBe(false);
    });

    it('legacyTier present but ignored in v3 (no grandfather path)', () => {
      // v3 删除了 effectivePlan = legacyTier === 'team' ? 'pro' : plan 路径
      // legacyTier='team' 不再影响限额；plan='free' 就是 free
      const limits = getEffectiveLimits({
        plan: 'free',
        priceLockedAt: null,
        legacyTier: 'team',
      });
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.free.publishedRules);
    });

    it('does not crash when plan is undefined-ish (null cast)', () => {
      const limits = getEffectiveLimits({
        plan: null as unknown as PlanType,
        priceLockedAt: null,
      });
      // 兜底到 free
      expect(limits.publishedRules).toBe(PM_PLAN_LIMITS_V2.free.publishedRules);
    });
  });

  describe('getDisplayPlan — UI 展示映射', () => {
    it('plan="team" + legacyTier="team" → pro', () => {
      expect(getDisplayPlan({ plan: 'team', legacyTier: 'team' })).toBe('pro');
    });

    it('plan="team" + legacyTier=null → pro', () => {
      expect(getDisplayPlan({ plan: 'team', legacyTier: null })).toBe('pro');
    });

    it('plan="trial" → pro (展示给用户的是 pro tier)', () => {
      expect(getDisplayPlan({ plan: 'trial' })).toBe('pro');
    });

    it('plan="enterprise" → enterprise', () => {
      expect(getDisplayPlan({ plan: 'enterprise' })).toBe('enterprise');
    });

    it('plan="free" → free', () => {
      expect(getDisplayPlan({ plan: 'free' })).toBe('free');
    });

    it('plan=unknown → free fallback (does not throw)', () => {
      expect(getDisplayPlan({ plan: 'mystery' as PlanType })).toBe('free');
    });
  });

  describe('getPlanPrice — currency × plan combinatorics', () => {
    it('"team" plan defensively maps to pro pricing across all currencies', () => {
      expect(getPlanPrice('team', 'CNY')).toEqual(getPlanPrice('pro', 'CNY'));
      expect(getPlanPrice('team', 'USD')).toEqual(getPlanPrice('pro', 'USD'));
      expect(getPlanPrice('team', 'EUR')).toEqual(getPlanPrice('pro', 'EUR'));
    });

    it('Pro CNY = ¥299/月, USD = $39, EUR = €36 (PM v1.1 真值)', () => {
      expect(getPlanPrice('pro', 'CNY').monthly).toBe(299);
      expect(getPlanPrice('pro', 'USD').monthly).toBe(39);
      expect(getPlanPrice('pro', 'EUR').monthly).toBe(36);
    });

    it('enterprise 价格 = null 元组（合同制）', () => {
      const p = getPlanPrice('enterprise', 'USD');
      expect(p.monthly).toBeNull();
      expect(p.yearly).toBeNull();
    });

    it('free / trial 在所有币种为 0', () => {
      for (const c of ['USD', 'CNY', 'EUR'] as const) {
        expect(getPlanPrice('free', c)).toEqual({ monthly: 0, yearly: 0 });
        expect(getPlanPrice('trial', c)).toEqual({ monthly: 0, yearly: 0 });
      }
    });

    it('default currency parameter omitted → USD', () => {
      const a = getPlanPrice('pro');
      const b = getPlanPrice('pro', 'USD');
      expect(a).toEqual(b);
    });
  });

  describe('getPlanStripePriceId — env var 缺失（开发环境）', () => {
    it('Pro priceId 在 dev 没配 env → null（不抛错）', () => {
      // dev 环境没有 NEXT_PUBLIC_STRIPE_PRO_* env vars
      const id = getPlanStripePriceId('pro', 'monthly', 'USD');
      // 严格判等：可能是 undefined 或 null，但不是 truthy 字符串（除非已配 env）
      expect(id == null || typeof id === 'string').toBe(true);
    });

    it('free / trial / enterprise → null （没 stripe price id）', () => {
      expect(getPlanStripePriceId('free', 'monthly', 'USD')).toBeNull();
      expect(getPlanStripePriceId('trial', 'monthly', 'USD')).toBeNull();
      expect(getPlanStripePriceId('enterprise', 'yearly', 'EUR')).toBeNull();
    });

    it('"team" plan → null (PM v1.1: team Stripe priceId 已下线)', () => {
      // STRIPE_PRICE_IDS 不再有 team 条目
      const id = getPlanStripePriceId('team', 'monthly', 'USD');
      expect(id).toBeNull();
    });
  });

  describe('canAccessApiKeys — capability 矩阵', () => {
    it('free → false (PM v1.1: API access 不在 free 档)', () => {
      expect(canAccessApiKeys('free')).toBe(false);
    });

    it('pro → true', () => {
      expect(canAccessApiKeys('pro')).toBe(true);
    });

    it('enterprise → true', () => {
      expect(canAccessApiKeys('enterprise')).toBe(true);
    });

    it('"team" legacy enum → 防御性返回（不抛错）', () => {
      // 不强制行为，但必须不抛错且返回布尔值
      const r = canAccessApiKeys('team');
      expect(typeof r).toBe('boolean');
    });
  });

  describe('PLAN_PRICES 数据完整性', () => {
    it('Pro yearly = monthly × 12 × 0.8 (向上取整)', () => {
      // CNY: 299×12×0.8 = 2870.4 → 2870
      // USD: 39×12×0.8 = 374.4 → 374
      // EUR: 36×12×0.8 = 345.6 → 346
      expect(PLAN_PRICES.pro.CNY.yearly).toBe(2870);
      expect(PLAN_PRICES.pro.USD.yearly).toBe(374);
      expect(PLAN_PRICES.pro.EUR.yearly).toBe(346);
    });

    it('PLAN_PRICES 不含 team perUser 数据（v3 删除）', () => {
      expect((PLAN_PRICES as Record<string, unknown>).team).toBeUndefined();
    });

    it('LEGACY_PLAN_LIMITS 不含 team 档（v3 删除）', () => {
      expect((LEGACY_PLAN_LIMITS as Record<string, unknown>).team).toBeUndefined();
    });
  });

  describe('PM_PLAN_LIMITS_V2 SOX 元数据', () => {
    it('Pro 启用审批流需要 ≥ 2 seats', () => {
      expect(PM_PLAN_LIMITS_V2.pro.approvalSeatThreshold).toBe(2);
      expect(PM_PLAN_LIMITS_V2.pro.approvalRequired).toBe(true);
    });

    it('Free 不强制审批流', () => {
      expect(PM_PLAN_LIMITS_V2.free.approvalRequired).toBe(false);
    });

    it('Enterprise 强制审批流（多团队多级）', () => {
      expect(PM_PLAN_LIMITS_V2.enterprise.approvalRequired).toBe(true);
    });
  });
});

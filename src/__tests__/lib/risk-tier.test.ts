import { describe, it, expect } from 'vitest';
import { policyForTier, type RiskTier } from '@/lib/risk-tier';

describe('risk-tier policy', () => {
  describe('tier-to-policy mapping', () => {
    it('tier 0 (trusted) full trial + full quota + checkout allowed', () => {
      const p = policyForTier(0);
      expect(p.trialDays).toBe(14);
      expect(p.aiQuotaMultiplier).toBe(1);
      expect(p.apiQuotaMultiplier).toBe(1);
      expect(p.allowStripeCheckout).toBe(true);
      expect(p.requireEmailVerifiedForApi).toBe(false);
      expect(p.alertOnRegistration).toBe(false);
    });

    it('tier 1 (normal) shortens trial, halves AI', () => {
      const p = policyForTier(1);
      expect(p.trialDays).toBe(7);
      expect(p.aiQuotaMultiplier).toBe(0.5);
      expect(p.apiQuotaMultiplier).toBe(1); // API not yet penalized at tier 1
      expect(p.allowStripeCheckout).toBe(true);
    });

    it('tier 2 (elevated) kills trial, quarters AI, requires email verify, alerts', () => {
      const p = policyForTier(2);
      expect(p.trialDays).toBe(0);
      expect(p.aiQuotaMultiplier).toBe(0.25);
      expect(p.apiQuotaMultiplier).toBe(0.5);
      expect(p.requireEmailVerifiedForApi).toBe(true);
      expect(p.alertOnRegistration).toBe(true);
    });

    it('tier 3 (high) disables AI but allows reduced API; checkout blocked', () => {
      const p = policyForTier(3);
      expect(p.aiQuotaMultiplier).toBe(0);
      expect(p.apiQuotaMultiplier).toBe(0.25);
      expect(p.allowStripeCheckout).toBe(false);
    });

    it('tier 4 (hard block) zeroes all quotas + blocks checkout', () => {
      const p = policyForTier(4);
      expect(p.trialDays).toBe(0);
      expect(p.aiQuotaMultiplier).toBe(0);
      expect(p.apiQuotaMultiplier).toBe(0);
      expect(p.allowStripeCheckout).toBe(false);
    });
  });

  describe('monotonicity (higher tier ≤ lower tier limits)', () => {
    it('trialDays non-increasing as tier rises', () => {
      const tiers: RiskTier[] = [0, 1, 2, 3, 4];
      const days = tiers.map((t) => policyForTier(t).trialDays);
      for (let i = 1; i < days.length; i++) {
        expect(days[i]).toBeLessThanOrEqual(days[i - 1]!);
      }
    });

    it('aiQuotaMultiplier non-increasing as tier rises', () => {
      const tiers: RiskTier[] = [0, 1, 2, 3, 4];
      const mults = tiers.map((t) => policyForTier(t).aiQuotaMultiplier);
      for (let i = 1; i < mults.length; i++) {
        expect(mults[i]).toBeLessThanOrEqual(mults[i - 1]!);
      }
    });

    it('allowStripeCheckout never re-allows after being denied', () => {
      // tiers 0-2 allow, 3-4 block; verify no oscillation
      const allowed = [0, 1, 2, 3, 4].map((t) => policyForTier(t as RiskTier).allowStripeCheckout);
      // once false, stay false
      let seenFalse = false;
      for (const v of allowed) {
        if (!v) seenFalse = true;
        else expect(seenFalse).toBe(false);
      }
    });
  });

  describe('appeal path (security property)', () => {
    it('even hard-block tier 4 has a documented escalation channel', () => {
      // 不是断言代码行为，而是给未来 reviewer 一个 anchor：
      // tier 4 = registration goes through (let them in) but quotas are 0;
      // admin can manually flip riskTier to 0 to restore. No row gets blocked
      // from creation, so support can always reach the user via email.
      const p = policyForTier(4);
      expect(p.trialDays).toBe(0);
      expect(p.aiQuotaMultiplier).toBe(0);
      // 没有 "deny registration" 字段——这是有意的设计选择
    });
  });
});

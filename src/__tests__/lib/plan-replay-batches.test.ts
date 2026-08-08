import { describe, it, expect } from 'vitest';
import {
  getEffectiveLimits,
  PM_PLAN_LIMITS_V2,
  LEGACY_PLAN_LIMITS,
  type PlanType,
} from '@/lib/plans';

/**
 * What-If 并发批次权益（ADR 0034 §7.2）。
 *
 * <p>这个字段是 aster-api 判断「租户能不能跑 What-If」的唯一依据，
 * 由本仓的 `/api/internal/tenant/:id/plan` 下发。**它是跨服务契约**——
 * 这里少给一档、给错值或漏掉某个 plan 枚举，aster-api 侧只会看到 undefined，
 * 而 undefined 在数值比较里既不 >0 也不 <0，会静默变成「谁都不能用」或
 * 更糟的「谁都能用」，取决于对面怎么写判断。
 *
 * <p>故本文件锁住三件事：档位值、全枚举覆盖、以及 `-1` 的语义。
 */
describe('What-If 并发批次权益（ADR 0034 §7.2）', () => {
  describe('档位值', () => {
    it('★free = 0——免费档完全不提供 What-If，不是「只能跑一个」', () => {
      expect(getEffectiveLimits({ plan: 'free' }).concurrentReplayBatches).toBe(0);
    });

    it('pro = 1', () => {
      expect(getEffectiveLimits({ plan: 'pro' }).concurrentReplayBatches).toBe(1);
    });

    it('enterprise = -1（按合同配置，-1 表示不限）', () => {
      expect(getEffectiveLimits({ plan: 'enterprise' }).concurrentReplayBatches).toBe(-1);
    });
  });

  describe('全枚举覆盖', () => {
    // 历史 enum：'team' / 'trial' 会被 normalize 成 pro（PM v1.1 三档化）
    const ALL_PLANS: PlanType[] = ['free', 'pro', 'enterprise', 'team', 'trial'] as PlanType[];

    it.each(ALL_PLANS)('★plan=%s 必须返回数字而非 undefined', (plan) => {
      const v = getEffectiveLimits({ plan }).concurrentReplayBatches;
      expect(typeof v).toBe('number');
      expect(Number.isNaN(v)).toBe(false);
    });

    it('★PM_PLAN_LIMITS_V2 每一档都要有此字段（加新档位时不能漏）', () => {
      for (const [tier, limits] of Object.entries(PM_PLAN_LIMITS_V2)) {
        expect(
          (limits as unknown as Record<string, unknown>).concurrentReplayBatches,
          `PM_PLAN_LIMITS_V2.${tier} 缺 concurrentReplayBatches`,
        ).toBeTypeOf('number');
      }
    });

    it('★LEGACY_PLAN_LIMITS 每一档也要有——老用户不能因缺字段变成 undefined', () => {
      for (const [tier, limits] of Object.entries(LEGACY_PLAN_LIMITS)) {
        expect(
          (limits as unknown as Record<string, unknown>).concurrentReplayBatches,
          `LEGACY_PLAN_LIMITS.${tier} 缺 concurrentReplayBatches`,
        ).toBeTypeOf('number');
      }
    });
  });

  describe('老用户价格锁定路径', () => {
    it('★锁定价的老用户走 LEGACY 表，同样要拿到有效值', () => {
      const v = getEffectiveLimits({
        plan: 'pro',
        priceLockedAt: new Date('2026-01-01'), // 早于 PRICE_LOCKED_CUTOFF
      }).concurrentReplayBatches;
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
    });

    it('★锁定价的 free 老用户仍是 0（不能因走老表就白拿付费能力）', () => {
      expect(
        getEffectiveLimits({
          plan: 'free',
          priceLockedAt: new Date('2026-01-01'),
        }).concurrentReplayBatches,
      ).toBe(0);
    });
  });

  describe('语义约定', () => {
    it('★值只允许 -1（不限）或 >= 0，不得出现其他负数', () => {
      for (const limits of Object.values(PM_PLAN_LIMITS_V2)) {
        const v: number = limits.concurrentReplayBatches;
        expect(v === -1 || v >= 0).toBe(true);
      }
    });

    it('★free 严格小于 pro——付费档不得比免费档更受限', () => {
      const free = getEffectiveLimits({ plan: 'free' }).concurrentReplayBatches;
      const pro = getEffectiveLimits({ plan: 'pro' }).concurrentReplayBatches;
      expect(free).toBeLessThan(pro);
    });
  });
});

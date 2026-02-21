import { describe, it, expect } from 'vitest';
import {
  PLANS,
  PLAN_PRICES,
  STRIPE_PRICE_IDS,
  canAccessApiKeys,
  formatPrice,
  getCurrencyForLocale,
  getPlanConfig,
  getPlanLimit,
  getPlanPrice,
  getPlanStripePriceId,
  getProPrice,
  getTeamMinUsers,
  getTeamPerUserPrice,
  getTeamStartingPrice,
} from '@/lib/plans';

describe('Plans Configuration', () => {
  it('should have all required plans', () => {
    expect(PLANS).toHaveProperty('free');
    expect(PLANS).toHaveProperty('trial');
    expect(PLANS).toHaveProperty('pro');
    expect(PLANS).toHaveProperty('team');
    expect(PLANS).toHaveProperty('enterprise');
  });

  it('should return correct limits', () => {
    expect(getPlanLimit('free', 'policies')).toBe(3);
    expect(getPlanLimit('pro', 'executions')).toBe(5000);
  });

  it('should correctly identify API key access', () => {
    expect(canAccessApiKeys('free')).toBe(false);
    expect(canAccessApiKeys('pro')).toBe(true);
    expect(canAccessApiKeys('team')).toBe(true);
  });

  it('should expose plan capabilities via getPlanConfig', () => {
    const proConfig = getPlanConfig('pro');

    expect(proConfig.capabilities.apiAccess).toBe(true);
    expect(proConfig.capabilities.teamFeatures).toBe(false);
  });
});

describe('Multi-currency pricing', () => {
  describe('getCurrencyForLocale', () => {
    it('should return USD for English locale', () => {
      expect(getCurrencyForLocale('en')).toBe('USD');
    });

    it('should return CNY for Chinese locale', () => {
      expect(getCurrencyForLocale('zh')).toBe('CNY');
    });

    it('should return EUR for German locale', () => {
      expect(getCurrencyForLocale('de')).toBe('EUR');
    });

    it('should default to USD for unknown locale', () => {
      expect(getCurrencyForLocale('unknown')).toBe('USD');
    });
  });

  describe('formatPrice', () => {
    it('should format USD correctly', () => {
      expect(formatPrice(29, 'USD')).toMatch(/\$29/);
    });

    it('should format CNY correctly', () => {
      expect(formatPrice(199, 'CNY')).toMatch(/¥199/);
    });

    it('should format EUR correctly', () => {
      expect(formatPrice(27, 'EUR')).toMatch(/€27|27\s*€/);
    });
  });

  describe('getProPrice', () => {
    it('should return correct USD prices', () => {
      expect(getProPrice('USD', 'monthly')).toBe(29);
      expect(getProPrice('USD', 'yearly')).toBe(290);
    });

    it('should return correct CNY prices', () => {
      expect(getProPrice('CNY', 'monthly')).toBe(199);
      expect(getProPrice('CNY', 'yearly')).toBe(1990);
    });
  });

  describe('getTeamPerUserPrice', () => {
    it('should return correct per-user prices', () => {
      expect(getTeamPerUserPrice('USD', 'monthly')).toBe(35);
      expect(getTeamPerUserPrice('EUR', 'yearly')).toBe(300);
    });
  });

  describe('getTeamStartingPrice', () => {
    it('should calculate correct starting price', () => {
      const minUsers = getTeamMinUsers();
      expect(getTeamStartingPrice('USD', 'monthly')).toBe(minUsers * 35);
    });
  });
});

describe('Price configuration consistency', () => {
  it('should align PLANS and PLAN_PRICES for Pro plan', () => {
    expect(PLANS.pro.price.monthly).toBe(PLAN_PRICES.pro.USD.monthly);
    expect(PLANS.pro.price.yearly).toBe(PLAN_PRICES.pro.USD.yearly);
  });
});

describe('getPlanPrice with currency', () => {
  it('should return USD prices by default', () => {
    const price = getPlanPrice('pro');
    expect(price.monthly).toBe(29);
    expect(price.yearly).toBe(290);
  });

  it('should return CNY prices when specified', () => {
    const price = getPlanPrice('pro', 'CNY');
    expect(price.monthly).toBe(199);
    expect(price.yearly).toBe(1990);
  });

  it('should return EUR prices when specified', () => {
    const price = getPlanPrice('pro', 'EUR');
    expect(price.monthly).toBe(27);
    expect(price.yearly).toBe(270);
  });

  it('should calculate team prices correctly for all currencies', () => {
    const minUsers = PLAN_PRICES.team.minUsers;

    const usdPrice = getPlanPrice('team', 'USD');
    expect(usdPrice.monthly).toBe(minUsers * 35);
    expect(usdPrice.yearly).toBe(minUsers * 350);

    const cnyPrice = getPlanPrice('team', 'CNY');
    expect(cnyPrice.monthly).toBe(minUsers * 239);
    expect(cnyPrice.yearly).toBe(minUsers * 2390);
  });

  it('should return zero for free/trial plans', () => {
    const freePrice = getPlanPrice('free', 'CNY');
    expect(freePrice.monthly).toBe(0);
    expect(freePrice.yearly).toBe(0);

    const trialPrice = getPlanPrice('trial', 'EUR');
    expect(trialPrice.monthly).toBe(0);
    expect(trialPrice.yearly).toBe(0);
  });

  it('should return null for enterprise plans', () => {
    const price = getPlanPrice('enterprise', 'USD');
    expect(price.monthly).toBeNull();
    expect(price.yearly).toBeNull();
  });
});

describe('getPlanStripePriceId with currency', () => {
  it('should return null for free and trial plans', () => {
    expect(getPlanStripePriceId('free', 'monthly', 'USD')).toBeNull();
    expect(getPlanStripePriceId('trial', 'yearly', 'CNY')).toBeNull();
  });

  it('should return null for enterprise plan', () => {
    expect(getPlanStripePriceId('enterprise', 'monthly', 'USD')).toBeNull();
  });

  it('should use default USD when currency not specified', () => {
    // 该函数应该默认使用 USD
    const withoutCurrency = getPlanStripePriceId('pro', 'monthly');
    const withUsd = getPlanStripePriceId('pro', 'monthly', 'USD');
    expect(withoutCurrency).toBe(withUsd);
  });
});

describe('STRIPE_PRICE_IDS structure', () => {
  it('should have pro plan with all currencies', () => {
    expect(STRIPE_PRICE_IDS.pro).toBeDefined();
    expect(STRIPE_PRICE_IDS.pro.USD).toBeDefined();
    expect(STRIPE_PRICE_IDS.pro.CNY).toBeDefined();
    expect(STRIPE_PRICE_IDS.pro.EUR).toBeDefined();
  });

  it('should have team plan with all currencies', () => {
    expect(STRIPE_PRICE_IDS.team).toBeDefined();
    expect(STRIPE_PRICE_IDS.team.USD).toBeDefined();
    expect(STRIPE_PRICE_IDS.team.CNY).toBeDefined();
    expect(STRIPE_PRICE_IDS.team.EUR).toBeDefined();
  });

  it('should have monthly and yearly for each currency', () => {
    const currencies = ['USD', 'CNY', 'EUR'] as const;
    const plans = ['pro', 'team'] as const;

    for (const plan of plans) {
      for (const currency of currencies) {
        expect(STRIPE_PRICE_IDS[plan][currency]).toHaveProperty('monthly');
        expect(STRIPE_PRICE_IDS[plan][currency]).toHaveProperty('yearly');
      }
    }
  });
});

describe('Multi-currency integration flow', () => {
  it('should provide consistent pricing from locale to display', () => {
    // 模拟用户从中国访问
    const locale = 'zh';
    const currency = getCurrencyForLocale(locale);
    expect(currency).toBe('CNY');

    // 获取价格
    const price = getPlanPrice('pro', currency);
    expect(price.monthly).toBe(199);

    // 格式化显示
    const formatted = formatPrice(price.monthly!, currency);
    expect(formatted).toMatch(/¥199/);
  });

  it('should provide consistent pricing for EUR locale', () => {
    const locale = 'de';
    const currency = getCurrencyForLocale(locale);
    expect(currency).toBe('EUR');

    const price = getPlanPrice('pro', currency);
    expect(price.monthly).toBe(27);

    const formatted = formatPrice(price.monthly!, currency);
    expect(formatted).toMatch(/€27|27\s*€/);
  });

  it('should calculate team pricing correctly across currencies', () => {
    const minUsers = getTeamMinUsers();

    // USD
    expect(getTeamStartingPrice('USD', 'monthly')).toBe(minUsers * 35);
    expect(getTeamPerUserPrice('USD', 'monthly')).toBe(35);

    // CNY
    expect(getTeamStartingPrice('CNY', 'monthly')).toBe(minUsers * 239);
    expect(getTeamPerUserPrice('CNY', 'monthly')).toBe(239);

    // EUR
    expect(getTeamStartingPrice('EUR', 'monthly')).toBe(minUsers * 30);
    expect(getTeamPerUserPrice('EUR', 'monthly')).toBe(30);
  });
});

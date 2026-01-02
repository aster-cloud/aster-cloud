// src/lib/plans.ts
// 单一真相源：集中管理订阅计划的展示、配额与价格配置

// ==================== 货币配置 ====================
export const CURRENCY_CONFIG = {
  USD: { symbol: '$', code: 'USD', locale: 'en-US' },
  CNY: { symbol: '¥', code: 'CNY', locale: 'zh-CN' },
  EUR: { symbol: '€', code: 'EUR', locale: 'de-DE' },
} as const;

export type CurrencyCode = keyof typeof CURRENCY_CONFIG;

// 语言到默认货币的映射
export const LOCALE_CURRENCY_MAP: Record<string, CurrencyCode> = {
  en: 'USD',
  zh: 'CNY',
  de: 'EUR',
  fr: 'EUR',
};

// 多币种价格配置
export const PLAN_PRICES = {
  pro: {
    USD: { monthly: 29, yearly: 290 },
    CNY: { monthly: 199, yearly: 1990 },
    EUR: { monthly: 27, yearly: 270 },
  },
  team: {
    minUsers: 3,
    perUser: {
      USD: { monthly: 35, yearly: 350 },
      CNY: { monthly: 239, yearly: 2390 },
      EUR: { monthly: 30, yearly: 300 },
    },
  },
} as const;

// 多币种 Stripe 价格 ID 配置
// 环境变量命名规则：NEXT_PUBLIC_STRIPE_{PLAN}_{INTERVAL}_{CURRENCY}_PRICE_ID
export const STRIPE_PRICE_IDS: Record<string, Record<CurrencyCode, { monthly: string | undefined; yearly: string | undefined }>> = {
  pro: {
    USD: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID,
      yearly: process.env.NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID,
    },
    CNY: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID,
      yearly: process.env.NEXT_PUBLIC_STRIPE_PRO_YEARLY_CNY_PRICE_ID,
    },
    EUR: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_EUR_PRICE_ID,
      yearly: process.env.NEXT_PUBLIC_STRIPE_PRO_YEARLY_EUR_PRICE_ID,
    },
  },
  team: {
    USD: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_PRICE_ID,
      yearly: process.env.NEXT_PUBLIC_STRIPE_TEAM_YEARLY_PRICE_ID,
    },
    CNY: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_CNY_PRICE_ID,
      yearly: process.env.NEXT_PUBLIC_STRIPE_TEAM_YEARLY_CNY_PRICE_ID,
    },
    EUR: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_EUR_PRICE_ID,
      yearly: process.env.NEXT_PUBLIC_STRIPE_TEAM_YEARLY_EUR_PRICE_ID,
    },
  },
};

// ==================== 类型定义 ====================
type BillingPrice = {
  monthly: number | null;
  yearly: number | null;
};

type PlanLimits = {
  policies: number;
  executions: number;
  apiKeys: number;
  teamMembers: number;
};

export type PlanCapabilities = {
  piiDetection: 'basic' | 'advanced';
  sharing: boolean;
  complianceReports: boolean;
  apiAccess: boolean;
  teamFeatures: boolean;
  sso?: boolean;
  auditLogs?: boolean;
  customIntegrations?: boolean;
};

// Plan feature keys for i18n (use with t('billing.plans.features.{key}'))
// 统一用于首页和账单页的功能描述
export const PLAN_FEATURE_KEYS = {
  // Free 计划特性
  policies3: 'policies3',
  executions100: 'executions100',
  basicPii: 'basicPii',
  // Pro 计划特性
  policies25: 'policies25',
  executions5000: 'executions5000',
  allComplianceReports: 'allComplianceReports',
  apiAccess: 'apiAccess',
  // Team 计划特性
  unlimitedPolicies: 'unlimitedPolicies',
  executions50000: 'executions50000',
  teamCollaboration: 'teamCollaboration',
  ssoRbac: 'ssoRbac',
  prioritySupport: 'prioritySupport',
  // Enterprise 计划特性
  customDeployment: 'customDeployment',
  slaGuarantee: 'slaGuarantee',
  dedicatedSupport: 'dedicatedSupport',
  customIntegrations: 'customIntegrations',
} as const;

export const PLANS = {
  free: {
    name: 'free',
    limits: {
      policies: 3,
      executions: 100,
      apiKeys: 0,
      teamMembers: 1,
    },
    featureKeys: ['policies3', 'executions100', 'basicPii'],
    capabilities: {
      piiDetection: 'basic',
      sharing: false,
      complianceReports: false,
      apiAccess: false,
      teamFeatures: false,
    },
    price: { monthly: 0, yearly: 0 },
    stripePriceId: null,
  },
  trial: {
    name: 'trial',
    limits: {
      policies: 25,
      executions: 5000,
      apiKeys: 5,
      teamMembers: 5,
    },
    featureKeys: ['policies25', 'executions5000', 'allComplianceReports', 'apiAccess'],
    capabilities: {
      piiDetection: 'advanced',
      sharing: true,
      complianceReports: true,
      apiAccess: true,
      teamFeatures: false,
    },
    price: { monthly: 0, yearly: 0 },
    stripePriceId: null,
    trialDays: 14,
  },
  pro: {
    name: 'pro',
    limits: {
      policies: 25,
      executions: 5000,
      apiKeys: 5,
      teamMembers: 5,
    },
    featureKeys: ['policies25', 'executions5000', 'allComplianceReports', 'apiAccess'],
    capabilities: {
      piiDetection: 'advanced',
      sharing: true,
      complianceReports: true,
      apiAccess: true,
      teamFeatures: false,
    },
    price: PLAN_PRICES.pro.USD,
    stripePriceId: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID,
      yearly: process.env.NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID,
    },
  },
  team: {
    name: 'team',
    limits: {
      policies: -1,
      executions: 50000,
      apiKeys: 20,
      teamMembers: -1,
    },
    featureKeys: ['unlimitedPolicies', 'executions50000', 'teamCollaboration', 'ssoRbac', 'prioritySupport'],
    capabilities: {
      piiDetection: 'advanced',
      sharing: true,
      complianceReports: true,
      apiAccess: true,
      teamFeatures: true,
      sso: true,
      auditLogs: true,
    },
    price: {
      monthly: PLAN_PRICES.team.minUsers * PLAN_PRICES.team.perUser.USD.monthly,
      yearly: PLAN_PRICES.team.minUsers * PLAN_PRICES.team.perUser.USD.yearly,
    },
    stripePriceId: {
      monthly: process.env.NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_PRICE_ID,
      yearly: process.env.NEXT_PUBLIC_STRIPE_TEAM_YEARLY_PRICE_ID,
    },
  },
  enterprise: {
    name: 'enterprise',
    limits: {
      policies: -1,
      executions: -1,
      apiKeys: -1,
      teamMembers: -1,
    },
    featureKeys: ['customDeployment', 'slaGuarantee', 'dedicatedSupport', 'customIntegrations'],
    capabilities: {
      piiDetection: 'advanced',
      sharing: true,
      complianceReports: true,
      apiAccess: true,
      teamFeatures: true,
      sso: true,
      auditLogs: true,
      customIntegrations: true,
    },
    price: { monthly: null, yearly: null },
    stripePriceId: null,
  },
} as const satisfies Record<
  string,
  {
    name: string;
    limits: PlanLimits;
    featureKeys: readonly string[];
    capabilities: PlanCapabilities;
    price: BillingPrice;
    stripePriceId: { monthly: string | undefined | null; yearly: string | undefined | null } | null;
    trialDays?: number;
  }
>;

export type PlanType = keyof typeof PLANS;
export type PlanConfig = (typeof PLANS)[PlanType];
export type PlanLimitType = keyof PlanConfig['limits'];
export type BillingInterval = keyof PlanConfig['price'];

/**
 * 根据计划与币种返回价格，确保单一真相源
 */
export function getPlanPrice(plan: PlanType, currency: CurrencyCode = 'USD'): BillingPrice {
  switch (plan) {
    case 'pro':
      return PLAN_PRICES.pro[currency];
    case 'team': {
      const perUser = PLAN_PRICES.team.perUser[currency];
      const minUsers = PLAN_PRICES.team.minUsers;
      return {
        monthly: perUser.monthly * minUsers,
        yearly: perUser.yearly * minUsers,
      };
    }
    case 'free':
    case 'trial':
      return { monthly: 0, yearly: 0 };
    case 'enterprise':
    default:
      return { monthly: null, yearly: null };
  }
}

export function getPlanConfig(plan: PlanType): PlanConfig {
  return PLANS[plan];
}

export function getPlanLimit(plan: PlanType, limitType: PlanLimitType): number {
  return PLANS[plan].limits[limitType];
}

export function hasFeature(plan: PlanType, feature: string): boolean {
  return (PLANS[plan].featureKeys as readonly string[]).includes(feature);
}

export function isUnlimited(limit: number): boolean {
  return limit === -1;
}

export function canAccessApiKeys(plan: PlanType): boolean {
  return PLANS[plan].limits.apiKeys > 0;
}

export function hasCapability(plan: PlanType, capability: keyof PlanCapabilities): boolean {
  const capabilities = PLANS[plan].capabilities as PlanCapabilities;
  return Boolean(capabilities[capability]);
}

/**
 * 获取计划的 Stripe 价格 ID（支持多币种）
 * @param plan 计划类型
 * @param interval 计费周期
 * @param currency 货币代码（默认 USD）
 */
export function getPlanStripePriceId(
  plan: PlanType,
  interval: BillingInterval,
  currency: CurrencyCode = 'USD'
): string | null {
  // 检查是否有多币种价格 ID 配置
  const currencyPriceIds = STRIPE_PRICE_IDS[plan]?.[currency];
  if (currencyPriceIds) {
    const priceId = currencyPriceIds[interval];
    if (priceId) return priceId;
  }

  // 回退到 USD 价格 ID（如果当前货币未配置）
  if (currency !== 'USD') {
    const usdPriceIds = STRIPE_PRICE_IDS[plan]?.USD;
    if (usdPriceIds) {
      const usdPriceId = usdPriceIds[interval];
      if (usdPriceId) return usdPriceId;
    }
  }

  // 最后回退到 PLANS 中的旧配置（兼容性）
  const legacyIds = PLANS[plan].stripePriceId;
  return legacyIds ? legacyIds[interval] ?? null : null;
}

// ==================== 多币种价格函数 ====================

/**
 * 根据语言获取默认货币
 */
export function getCurrencyForLocale(locale: string): CurrencyCode {
  return LOCALE_CURRENCY_MAP[locale] || 'USD';
}

/**
 * 格式化价格显示
 */
export function formatPrice(amount: number, currency: CurrencyCode): string {
  const config = CURRENCY_CONFIG[currency];
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * 获取 Pro 计划的价格
 */
export function getProPrice(currency: CurrencyCode, interval: BillingInterval): number {
  return PLAN_PRICES.pro[currency][interval];
}

/**
 * 获取 Team 计划的单用户价格
 */
export function getTeamPerUserPrice(currency: CurrencyCode, interval: BillingInterval): number {
  return PLAN_PRICES.team.perUser[currency][interval];
}

/**
 * 获取 Team 计划的最少用户数
 */
export function getTeamMinUsers(): number {
  return PLAN_PRICES.team.minUsers;
}

/**
 * 获取 Team 计划的起始价格（最少用户数 * 单用户价格）
 */
export function getTeamStartingPrice(currency: CurrencyCode, interval: BillingInterval): number {
  return PLAN_PRICES.team.minUsers * PLAN_PRICES.team.perUser[currency][interval];
}

// src/lib/plans.ts
// 单一真相源：集中管理订阅计划的展示、配额与价格配置

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

export const PLANS = {
  free: {
    name: 'Free',
    displayName: '免费版',
    limits: {
      policies: 3,
      executions: 100,
      apiKeys: 0,
      teamMembers: 1,
    },
    features: ['基础策略管理', '有限执行次数'],
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
    name: 'Trial',
    displayName: '试用版',
    limits: {
      policies: 10,
      executions: 500,
      apiKeys: 1,
      teamMembers: 1,
    },
    features: ['扩展策略管理', '更多执行次数', 'API 访问'],
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
    name: 'Pro',
    displayName: '专业版',
    limits: {
      policies: 50,
      executions: 5000,
      apiKeys: 5,
      teamMembers: 1,
    },
    features: ['无限策略', '大量执行次数', '完整 API 访问', '优先支持'],
    capabilities: {
      piiDetection: 'advanced',
      sharing: true,
      complianceReports: true,
      apiAccess: true,
      teamFeatures: false,
    },
    price: { monthly: 29, yearly: 290 },
    stripePriceId: {
      monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
      yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID,
    },
  },
  team: {
    name: 'Team',
    displayName: '团队版',
    limits: {
      policies: -1,
      executions: -1,
      apiKeys: 20,
      teamMembers: 10,
    },
    features: ['无限策略', '无限执行', '团队协作', '管理员控制', '审计日志'],
    capabilities: {
      piiDetection: 'advanced',
      sharing: true,
      complianceReports: true,
      apiAccess: true,
      teamFeatures: true,
      sso: true,
      auditLogs: true,
    },
    price: { monthly: 99, yearly: 990 },
    stripePriceId: {
      monthly: process.env.STRIPE_TEAM_MONTHLY_PRICE_ID,
      yearly: process.env.STRIPE_TEAM_YEARLY_PRICE_ID,
    },
  },
  enterprise: {
    name: 'Enterprise',
    displayName: '企业版',
    limits: {
      policies: -1,
      executions: -1,
      apiKeys: -1,
      teamMembers: -1,
    },
    features: ['自定义部署', 'SLA 保障', '专属支持', '定制集成'],
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
    displayName: string;
    limits: PlanLimits;
    features: readonly string[];
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

export function getPlanConfig(plan: PlanType): PlanConfig {
  return PLANS[plan];
}

export function getPlanLimit(plan: PlanType, limitType: PlanLimitType): number {
  return PLANS[plan].limits[limitType];
}

export function hasFeature(plan: PlanType, feature: string): boolean {
  return (PLANS[plan].features as readonly string[]).includes(feature);
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

export function getPlanStripePriceId(plan: PlanType, interval: BillingInterval) {
  const ids = PLANS[plan].stripePriceId;
  return ids ? ids[interval] ?? null : null;
}

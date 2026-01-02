import { prisma } from '@/lib/prisma';
import {
  PLANS,
  getPlanConfig,
  getPlanLimit,
  isUnlimited,
  PlanCapabilities,
  PlanLimitType,
  PlanType,
} from '@/lib/plans';

export type UsageType = 'execution' | 'pii_scan' | 'compliance_report' | 'api_call';

const USAGE_LIMIT_MAPPING: Record<UsageType, PlanLimitType | null> = {
  execution: 'executions',
  pii_scan: null,
  compliance_report: null,
  api_call: 'apiCalls',  // API 调用独立配额
};

// 获取当前周期字符串（YYYY-MM）
function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function normalizePlan(plan?: string | null): PlanType {
  if (plan && plan in PLANS) {
    return plan as PlanType;
  }
  return 'free';
}

function resolvePlan(plan: PlanType, trialEndsAt: Date | null) {
  if (plan === 'trial' && trialEndsAt && trialEndsAt < new Date()) {
    return { plan: 'free' as PlanType, downgraded: true };
  }
  return { plan, downgraded: false };
}

// 检查指定用量是否超限
export async function checkUsageLimit(
  userId: string,
  type: UsageType
): Promise<{ allowed: boolean; remaining?: number; limit?: number; message?: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      plan: true,
      trialEndsAt: true,
    },
  });

  if (!user) {
    return { allowed: false, message: 'User not found' };
  }

  const normalizedPlan = normalizePlan(user.plan);
  const { plan: effectivePlan, downgraded } = resolvePlan(normalizedPlan, user.trialEndsAt);

  if (downgraded) {
    await prisma.user.update({
      where: { id: userId },
      data: { plan: effectivePlan },
    });
  }

  const limitKey = USAGE_LIMIT_MAPPING[type];
  if (!limitKey) {
    return { allowed: true, limit: -1, remaining: -1 };
  }

  const limit = getPlanLimit(effectivePlan, limitKey);
  if (isUnlimited(limit)) {
    return { allowed: true, limit, remaining: -1 };
  }

  const period = getCurrentPeriod();
  const usage = await prisma.usageRecord.findUnique({
    where: {
      userId_type_period: {
        userId,
        type,
        period,
      },
    },
  });

  const currentCount = usage?.count || 0;

  if (currentCount >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      message: `You've reached your monthly limit of ${limit} ${type}s. Upgrade to unlock more capacity.`,
    };
  }

  return {
    allowed: true,
    limit,
    remaining: limit - currentCount,
  };
}

// 记录用量计数
export async function recordUsage(userId: string, type: UsageType, count = 1): Promise<void> {
  const period = getCurrentPeriod();

  await prisma.usageRecord.upsert({
    where: {
      userId_type_period: {
        userId,
        type,
        period,
      },
    },
    update: {
      count: { increment: count },
    },
    create: {
      userId,
      type,
      period,
      count,
    },
  });
}

// 获取用户用量统计
export async function getUsageStats(userId: string) {
  const period = getCurrentPeriod();

  const [user, usageRecords, policyCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true, trialEndsAt: true },
    }),
    prisma.usageRecord.findMany({
      where: { userId, period },
    }),
    prisma.policy.count({
      where: { userId },
    }),
  ]);

  const normalizedPlan = normalizePlan(user?.plan || 'free');
  const { plan: effectivePlan, downgraded } = resolvePlan(normalizedPlan, user?.trialEndsAt ?? null);

  if (downgraded) {
    await prisma.user.update({
      where: { id: userId },
      data: { plan: effectivePlan },
    });
  }

  const planConfig = getPlanConfig(effectivePlan);
  const { limits, capabilities } = planConfig;

  let trialDaysLeft: number | null = null;
  if (effectivePlan === 'trial' && user?.trialEndsAt) {
    const now = new Date();
    const diff = user.trialEndsAt.getTime() - now.getTime();
    trialDaysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  const usageByType: Record<string, number> = {};
  for (const record of usageRecords) {
    usageByType[record.type] = record.count;
  }

  return {
    plan: effectivePlan,
    trialDaysLeft,
    limits,
    usage: {
      executions: usageByType.execution || 0,  // 使用 UsageRecord，与配额检查一致
      executionsLimit: limits.executions,
      policies: policyCount,
      policiesLimit: limits.policies,
      piiScans: usageByType.pii_scan || 0,
      complianceReports: usageByType.compliance_report || 0,
      apiCalls: usageByType.api_call || 0,
      apiCallsLimit: limits.apiCalls,
    },
    features: {
      piiDetection: capabilities.piiDetection,
      sharing: capabilities.sharing,
      complianceReports: capabilities.complianceReports,
      apiAccess: capabilities.apiAccess,
      teamFeatures: capabilities.teamFeatures,
    },
  };
}

// 检查指定功能是否可用
export async function hasFeatureAccess(
  userId: string,
  feature: keyof PlanCapabilities
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, trialEndsAt: true },
  });

  if (!user) return false;

  const normalizedPlan = normalizePlan(user.plan);
  const { plan: effectivePlan, downgraded } = resolvePlan(normalizedPlan, user.trialEndsAt);

  if (downgraded) {
    await prisma.user.update({
      where: { id: userId },
      data: { plan: effectivePlan },
    });
  }

  const capabilities = getPlanConfig(effectivePlan).capabilities as PlanCapabilities;
  const value = capabilities[feature];

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value > 0;
  }

  return Boolean(value);
}

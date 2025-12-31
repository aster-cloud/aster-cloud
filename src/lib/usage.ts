import { prisma } from '@/lib/prisma';

// Feature limits by plan
export const FEATURE_LIMITS = {
  free: {
    executionsPerMonth: 100,
    savedPolicies: 3,
    piiDetection: 'basic' as const,
    sharing: false,
    complianceReports: false,
    apiAccess: false,
    teamFeatures: false,
  },
  trial: {
    executionsPerMonth: Infinity,
    savedPolicies: Infinity,
    piiDetection: 'advanced' as const,
    sharing: true,
    complianceReports: true,
    apiAccess: true,
    teamFeatures: false,
  },
  pro: {
    executionsPerMonth: Infinity,
    savedPolicies: Infinity,
    piiDetection: 'advanced' as const,
    sharing: true,
    complianceReports: true,
    apiAccess: true,
    teamFeatures: false,
  },
  team: {
    executionsPerMonth: Infinity,
    savedPolicies: Infinity,
    piiDetection: 'advanced' as const,
    sharing: true,
    complianceReports: true,
    apiAccess: true,
    teamFeatures: true,
  },
  enterprise: {
    executionsPerMonth: Infinity,
    savedPolicies: Infinity,
    piiDetection: 'advanced' as const,
    sharing: true,
    complianceReports: true,
    apiAccess: true,
    teamFeatures: true,
    sso: true,
    auditLogs: true,
    customIntegrations: true,
  },
} as const;

export type UsageType = 'execution' | 'pii_scan' | 'compliance_report' | 'api_call';

// Get current period string (YYYY-MM)
function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Check if user can perform an action
export async function checkUsageLimit(
  userId: string,
  type: UsageType
): Promise<{ allowed: boolean; remaining?: number; message?: string }> {
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

  // Check if trial has expired
  let effectivePlan = user.plan;
  if (user.plan === 'trial' && user.trialEndsAt && user.trialEndsAt < new Date()) {
    // Trial expired, treat as free
    effectivePlan = 'free';

    // Update user's plan
    await prisma.user.update({
      where: { id: userId },
      data: { plan: 'free' },
    });
  }

  const limits = FEATURE_LIMITS[effectivePlan as keyof typeof FEATURE_LIMITS];

  // For unlimited plans, always allow
  if (type === 'execution' && limits.executionsPerMonth === Infinity) {
    return { allowed: true };
  }

  // Check current usage
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
  const limit = type === 'execution' ? limits.executionsPerMonth : Infinity;

  if (currentCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      message: `You've reached your monthly limit of ${limit} ${type}s. Upgrade to Pro for unlimited access.`,
    };
  }

  return {
    allowed: true,
    remaining: limit === Infinity ? undefined : limit - currentCount,
  };
}

// Record usage
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

// Get user's current usage stats
export async function getUsageStats(userId: string) {
  const period = getCurrentPeriod();

  const [user, usageRecords, policyCount, executionCount] = await Promise.all([
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
    prisma.execution.count({
      where: {
        userId,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
    }),
  ]);

  const plan = user?.plan || 'free';
  const limits = FEATURE_LIMITS[plan as keyof typeof FEATURE_LIMITS];

  // Check trial status
  let trialDaysLeft: number | null = null;
  if (plan === 'trial' && user?.trialEndsAt) {
    const now = new Date();
    const diff = user.trialEndsAt.getTime() - now.getTime();
    trialDaysLeft = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  const usageByType: Record<string, number> = {};
  for (const record of usageRecords) {
    usageByType[record.type] = record.count;
  }

  return {
    plan,
    trialDaysLeft,
    limits,
    usage: {
      executions: executionCount,
      executionsLimit: limits.executionsPerMonth,
      policies: policyCount,
      policiesLimit: limits.savedPolicies,
      piiScans: usageByType.pii_scan || 0,
      complianceReports: usageByType.compliance_report || 0,
      apiCalls: usageByType.api_call || 0,
    },
    features: {
      piiDetection: limits.piiDetection,
      sharing: limits.sharing,
      complianceReports: limits.complianceReports,
      apiAccess: limits.apiAccess,
      teamFeatures: limits.teamFeatures,
    },
  };
}

// Check if user has access to a specific feature
export async function hasFeatureAccess(
  userId: string,
  feature: keyof typeof FEATURE_LIMITS.free
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, trialEndsAt: true },
  });

  if (!user) return false;

  // Check if trial has expired
  let effectivePlan = user.plan;
  if (user.plan === 'trial' && user.trialEndsAt && user.trialEndsAt < new Date()) {
    effectivePlan = 'free';
  }

  const limits = FEATURE_LIMITS[effectivePlan as keyof typeof FEATURE_LIMITS];
  const value = limits[feature as keyof typeof limits];

  // For boolean features
  if (typeof value === 'boolean') {
    return value;
  }

  // For numeric features (treat any positive number as having access)
  if (typeof value === 'number') {
    return value > 0;
  }

  // For string features (treat any non-empty string as having access)
  return Boolean(value);
}

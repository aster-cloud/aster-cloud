// src/lib/policy-freeze.ts
// 策略冻结逻辑：当用户降级后，超出限制的策略将被冻结（只读，不可执行/编辑）

import { prisma } from '@/lib/prisma';
import { getPlanLimit, isUnlimited, PlanType, PLANS } from '@/lib/plans';

export interface PolicyFreezeInfo {
  isFrozen: boolean;
  reason?: string;
  activePoliciesLimit: number;
  totalPolicies: number;
  frozenCount: number;
}

export interface PolicyWithFreezeStatus {
  id: string;
  isFrozen: boolean;
}

/**
 * 获取用户的策略冻结状态
 * 规则：按 updatedAt 降序排序，前 N 个策略（N=限制数）为活跃，其余为冻结
 */
export async function getPolicyFreezeStatus(
  userId: string
): Promise<{
  limit: number;
  totalPolicies: number;
  frozenCount: number;
  frozenPolicyIds: Set<string>;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, trialEndsAt: true },
  });

  if (!user) {
    return { limit: 0, totalPolicies: 0, frozenCount: 0, frozenPolicyIds: new Set() };
  }

  // 计算有效套餐
  const plan = (user.plan && user.plan in PLANS ? user.plan : 'free') as PlanType;
  const trialExpired = plan === 'trial' && user.trialEndsAt && user.trialEndsAt < new Date();
  const effectivePlan = trialExpired ? 'free' : plan;

  const limit = getPlanLimit(effectivePlan, 'policies');

  // 无限制套餐不冻结，但仍返回真实策略数以供仪表盘展示
  if (isUnlimited(limit)) {
    const totalPolicies = await prisma.policy.count({ where: { userId } });
    return { limit: -1, totalPolicies, frozenCount: 0, frozenPolicyIds: new Set() };
  }

  // 获取所有策略，按更新时间降序，id 作为次级排序保证确定性
  const policies = await prisma.policy.findMany({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: { id: true },
  });

  const totalPolicies = policies.length;

  // 超出限制的策略 ID
  const frozenPolicyIds = new Set<string>();
  if (totalPolicies > limit) {
    for (let i = limit; i < totalPolicies; i++) {
      frozenPolicyIds.add(policies[i].id);
    }
  }

  return {
    limit,
    totalPolicies,
    frozenCount: frozenPolicyIds.size,
    frozenPolicyIds,
  };
}

/**
 * 检查单个策略是否被冻结
 * 优化版本：仅查询 limit 条活跃策略，避免全量扫描
 */
export async function isPolicyFrozen(userId: string, policyId: string): Promise<PolicyFreezeInfo> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, trialEndsAt: true },
  });

  if (!user) {
    return {
      isFrozen: false,
      activePoliciesLimit: 0,
      totalPolicies: 0,
      frozenCount: 0,
    };
  }

  // 计算有效套餐
  const plan = (user.plan && user.plan in PLANS ? user.plan : 'free') as PlanType;
  const trialExpired = plan === 'trial' && user.trialEndsAt && user.trialEndsAt < new Date();
  const effectivePlan = trialExpired ? 'free' : plan;
  const limit = getPlanLimit(effectivePlan, 'policies');

  // 无限制套餐不冻结，但仍返回真实策略数以供仪表盘展示
  if (isUnlimited(limit)) {
    const totalPolicies = await prisma.policy.count({ where: { userId } });
    return {
      isFrozen: false,
      activePoliciesLimit: -1,
      totalPolicies,
      frozenCount: 0,
    };
  }

  // 快速路径：仅获取策略总数和前 limit 条活跃策略 ID
  const [totalPolicies, activePolicies] = await Promise.all([
    prisma.policy.count({ where: { userId } }),
    prisma.policy.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    }),
  ]);

  // 如果总数未超限，无冻结
  if (totalPolicies <= limit) {
    return {
      isFrozen: false,
      activePoliciesLimit: limit,
      totalPolicies,
      frozenCount: 0,
    };
  }

  // 检查目标策略是否在活跃列表中
  const activeIds = new Set(activePolicies.map((p) => p.id));
  const isFrozen = !activeIds.has(policyId);
  const frozenCount = totalPolicies - limit;

  return {
    isFrozen,
    reason: isFrozen
      ? `Your plan allows ${limit} policies. This policy is frozen because you have ${totalPolicies} policies.`
      : undefined,
    activePoliciesLimit: limit,
    totalPolicies,
    frozenCount,
  };
}

/**
 * 为策略列表批量添加冻结状态
 */
export async function addFreezeStatusToPolicies<T extends { id: string }>(
  userId: string,
  policies: T[]
): Promise<(T & { isFrozen: boolean })[]> {
  const { frozenPolicyIds } = await getPolicyFreezeStatus(userId);

  return policies.map((policy) => ({
    ...policy,
    isFrozen: frozenPolicyIds.has(policy.id),
  }));
}

/**
 * 批量获取多个用户的策略冻结状态
 * 优化版本：减少 N+1 查询，通过批量查询用户和策略来计算冻结状态
 * 性能优化：先过滤出有限制的用户，仅对这些用户查询策略，无限制套餐跳过策略查询
 */
export async function getBatchPolicyFreezeStatus(
  userIds: string[]
): Promise<Map<string, Set<string>>> {
  if (userIds.length === 0) {
    return new Map();
  }

  // 去重
  const uniqueUserIds = [...new Set(userIds)];

  // 批量获取所有用户的套餐信息
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueUserIds } },
    select: { id: true, plan: true, trialEndsAt: true },
  });

  // 初始化结果，先计算每个用户的有效限制
  const result = new Map<string, Set<string>>();
  const limitedUserIds: string[] = [];
  const userLimits = new Map<string, number>();

  for (const user of users) {
    const plan = (user.plan && user.plan in PLANS ? user.plan : 'free') as PlanType;
    const trialExpired = plan === 'trial' && user.trialEndsAt && user.trialEndsAt < new Date();
    const effectivePlan = trialExpired ? 'free' : plan;
    const limit = getPlanLimit(effectivePlan, 'policies');

    // 无限制套餐直接设置空集合，不需要查询策略
    if (isUnlimited(limit)) {
      result.set(user.id, new Set());
    } else {
      limitedUserIds.push(user.id);
      userLimits.set(user.id, limit);
    }
  }

  // 仅对有限制的用户查询策略，id 作为次级排序保证确定性
  if (limitedUserIds.length > 0) {
    const limitedPolicies = await prisma.policy.findMany({
      where: { userId: { in: limitedUserIds } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: { id: true, userId: true },
    });

    // 按用户分组策略
    const policiesByUser = new Map<string, string[]>();
    for (const policy of limitedPolicies) {
      const userPolicies = policiesByUser.get(policy.userId) || [];
      userPolicies.push(policy.id);
      policiesByUser.set(policy.userId, userPolicies);
    }

    // 计算有限制用户的冻结策略 ID
    for (const userId of limitedUserIds) {
      const limit = userLimits.get(userId) || 0;
      const userPolicyIds = policiesByUser.get(userId) || [];
      const frozenIds = new Set<string>();

      // 超出限制的策略 ID（已按 updatedAt 降序排列）
      for (let i = limit; i < userPolicyIds.length; i++) {
        frozenIds.add(userPolicyIds[i]);
      }
      result.set(userId, frozenIds);
    }
  }

  return result;
}

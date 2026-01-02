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

  // 无限制套餐不冻结
  if (isUnlimited(limit)) {
    return { limit: -1, totalPolicies: 0, frozenCount: 0, frozenPolicyIds: new Set() };
  }

  // 获取所有策略，按更新时间降序
  const policies = await prisma.policy.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
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
 */
export async function isPolicyFrozen(userId: string, policyId: string): Promise<PolicyFreezeInfo> {
  const { limit, totalPolicies, frozenCount, frozenPolicyIds } = await getPolicyFreezeStatus(userId);

  return {
    isFrozen: frozenPolicyIds.has(policyId),
    reason: frozenPolicyIds.has(policyId)
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

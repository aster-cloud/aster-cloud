import { describe, it, expect, vi, beforeEach } from 'vitest';

// Define mock functions first
const mockUserFindUnique = vi.fn();
const mockPolicyFindMany = vi.fn();
const mockPolicyCount = vi.fn();

// 添加批量查询 mock
const mockUserFindMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
      findMany: (...args: unknown[]) => mockUserFindMany(...args),
    },
    policy: {
      findMany: (...args: unknown[]) => mockPolicyFindMany(...args),
      count: (...args: unknown[]) => mockPolicyCount(...args),
    },
  },
}));

vi.mock('@/lib/plans', () => ({
  PLANS: {
    free: { limits: { policies: 3 } },
    trial: { limits: { policies: 25 } },
    pro: { limits: { policies: 25 } },
    team: { limits: { policies: -1 } },
    enterprise: { limits: { policies: -1 } },
  },
  getPlanLimit: (plan: string, limitType: string) => {
    const limits: Record<string, Record<string, number>> = {
      free: { policies: 3 },
      trial: { policies: 25 },
      pro: { policies: 25 },
      team: { policies: -1 },
      enterprise: { policies: -1 },
    };
    return limits[plan]?.[limitType] ?? 0;
  },
  isUnlimited: (limit: number) => limit === -1,
  PlanType: {},
}));

// Import after mocking
import {
  getPolicyFreezeStatus,
  isPolicyFrozen,
  addFreezeStatusToPolicies,
  getBatchPolicyFreezeStatus,
} from '@/lib/policy-freeze';

describe('Policy Freeze Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPolicyFreezeStatus', () => {
    it('should return empty status for non-existent user', async () => {
      mockUserFindUnique.mockResolvedValue(null);

      const result = await getPolicyFreezeStatus('non-existent-user');

      expect(result).toEqual({
        limit: 0,
        totalPolicies: 0,
        frozenCount: 0,
        frozenPolicyIds: new Set(),
      });
    });

    it('should not freeze any policies for unlimited plan (team)', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'team',
        trialEndsAt: null,
      });
      // 无限制套餐仍返回真实策略数
      mockPolicyCount.mockResolvedValue(10);

      const result = await getPolicyFreezeStatus('team-user');

      expect(result.limit).toBe(-1);
      expect(result.totalPolicies).toBe(10);
      expect(result.frozenCount).toBe(0);
      expect(result.frozenPolicyIds.size).toBe(0);
    });

    it('should not freeze any policies for enterprise plan', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'enterprise',
        trialEndsAt: null,
      });
      // 无限制套餐仍返回真实策略数
      mockPolicyCount.mockResolvedValue(50);

      const result = await getPolicyFreezeStatus('enterprise-user');

      expect(result.limit).toBe(-1);
      expect(result.totalPolicies).toBe(50);
      expect(result.frozenCount).toBe(0);
    });

    it('should not freeze policies when under limit', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
        { id: 'policy-2' },
      ]);

      const result = await getPolicyFreezeStatus('free-user');

      expect(result.limit).toBe(3);
      expect(result.totalPolicies).toBe(2);
      expect(result.frozenCount).toBe(0);
      expect(result.frozenPolicyIds.size).toBe(0);
    });

    it('should not freeze policies when at limit', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
        { id: 'policy-2' },
        { id: 'policy-3' },
      ]);

      const result = await getPolicyFreezeStatus('free-user');

      expect(result.limit).toBe(3);
      expect(result.totalPolicies).toBe(3);
      expect(result.frozenCount).toBe(0);
      expect(result.frozenPolicyIds.size).toBe(0);
    });

    it('should freeze excess policies when over limit', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      // 5 policies, limit is 3, so 2 should be frozen
      // Policies are ordered by updatedAt desc, so last 2 are oldest
      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' }, // active (newest)
        { id: 'policy-2' }, // active
        { id: 'policy-3' }, // active
        { id: 'policy-4' }, // frozen
        { id: 'policy-5' }, // frozen (oldest)
      ]);

      const result = await getPolicyFreezeStatus('free-user');

      expect(result.limit).toBe(3);
      expect(result.totalPolicies).toBe(5);
      expect(result.frozenCount).toBe(2);
      expect(result.frozenPolicyIds.has('policy-4')).toBe(true);
      expect(result.frozenPolicyIds.has('policy-5')).toBe(true);
      expect(result.frozenPolicyIds.has('policy-1')).toBe(false);
      expect(result.frozenPolicyIds.has('policy-2')).toBe(false);
      expect(result.frozenPolicyIds.has('policy-3')).toBe(false);
    });

    it('should treat expired trial as free plan', async () => {
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday

      mockUserFindUnique.mockResolvedValue({
        plan: 'trial',
        trialEndsAt: expiredDate,
      });

      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
        { id: 'policy-2' },
        { id: 'policy-3' },
        { id: 'policy-4' },
        { id: 'policy-5' },
      ]);

      const result = await getPolicyFreezeStatus('trial-user');

      // Expired trial falls back to free (3 policies limit)
      expect(result.limit).toBe(3);
      expect(result.frozenCount).toBe(2);
    });

    it('should treat active trial as trial plan', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow

      mockUserFindUnique.mockResolvedValue({
        plan: 'trial',
        trialEndsAt: futureDate,
      });

      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
        { id: 'policy-2' },
        { id: 'policy-3' },
        { id: 'policy-4' },
        { id: 'policy-5' },
      ]);

      const result = await getPolicyFreezeStatus('trial-user');

      // Active trial has 25 policies limit
      expect(result.limit).toBe(25);
      expect(result.frozenCount).toBe(0);
    });

    it('should handle unknown plan as free', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'unknown-plan',
        trialEndsAt: null,
      });

      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
        { id: 'policy-2' },
        { id: 'policy-3' },
        { id: 'policy-4' },
      ]);

      const result = await getPolicyFreezeStatus('unknown-user');

      // Unknown plan falls back to free (3 policies limit)
      expect(result.limit).toBe(3);
      expect(result.frozenCount).toBe(1);
    });
  });

  describe('isPolicyFrozen', () => {
    it('should return frozen status for a specific policy', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      // 优化后的 isPolicyFrozen 使用 count + findMany(take: limit)
      mockPolicyCount.mockResolvedValue(4);
      // 只返回前 3 个活跃策略（limit=3）
      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
        { id: 'policy-2' },
        { id: 'policy-3' },
      ]);

      const frozenResult = await isPolicyFrozen('user-1', 'policy-4');

      expect(frozenResult.isFrozen).toBe(true);
      expect(frozenResult.reason).toContain('frozen');
      expect(frozenResult.activePoliciesLimit).toBe(3);
      expect(frozenResult.totalPolicies).toBe(4);
      expect(frozenResult.frozenCount).toBe(1);

      // 重置 mock 并测试活跃策略
      mockPolicyCount.mockResolvedValue(4);
      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
        { id: 'policy-2' },
        { id: 'policy-3' },
      ]);

      const activeResult = await isPolicyFrozen('user-1', 'policy-1');

      expect(activeResult.isFrozen).toBe(false);
      expect(activeResult.reason).toBeUndefined();
    });

    it('should return not frozen for non-existent policy when under limit', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      // 只有 1 个策略，未超限
      mockPolicyCount.mockResolvedValue(1);
      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
      ]);

      const result = await isPolicyFrozen('user-1', 'non-existent');

      // 未超限时，任何策略都不冻结
      expect(result.isFrozen).toBe(false);
    });
  });

  describe('addFreezeStatusToPolicies', () => {
    it('should add isFrozen flag to each policy', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
        { id: 'policy-2' },
        { id: 'policy-3' },
        { id: 'policy-4' },
      ]);

      const policies = [
        { id: 'policy-1', name: 'Policy 1' },
        { id: 'policy-2', name: 'Policy 2' },
        { id: 'policy-3', name: 'Policy 3' },
        { id: 'policy-4', name: 'Policy 4' },
      ];

      const result = await addFreezeStatusToPolicies('user-1', policies);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ id: 'policy-1', name: 'Policy 1', isFrozen: false });
      expect(result[1]).toEqual({ id: 'policy-2', name: 'Policy 2', isFrozen: false });
      expect(result[2]).toEqual({ id: 'policy-3', name: 'Policy 3', isFrozen: false });
      expect(result[3]).toEqual({ id: 'policy-4', name: 'Policy 4', isFrozen: true });
    });

    it('should preserve original policy properties', async () => {
      mockUserFindUnique.mockResolvedValue({
        plan: 'pro',
        trialEndsAt: null,
      });

      mockPolicyFindMany.mockResolvedValue([
        { id: 'policy-1' },
      ]);

      const policies = [
        {
          id: 'policy-1',
          name: 'Policy 1',
          description: 'Test description',
          isPublic: true,
          content: 'if x then y',
        },
      ];

      const result = await addFreezeStatusToPolicies('user-1', policies);

      expect(result[0]).toMatchObject({
        id: 'policy-1',
        name: 'Policy 1',
        description: 'Test description',
        isPublic: true,
        content: 'if x then y',
        isFrozen: false,
      });
    });
  });
});

describe('Policy Freeze Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle empty policy list', async () => {
    mockUserFindUnique.mockResolvedValue({
      plan: 'free',
      trialEndsAt: null,
    });

    mockPolicyFindMany.mockResolvedValue([]);

    const result = await getPolicyFreezeStatus('user-1');

    expect(result.limit).toBe(3);
    expect(result.totalPolicies).toBe(0);
    expect(result.frozenCount).toBe(0);
  });

  it('should handle exactly at limit after downgrade', async () => {
    // User downgraded from pro (25) to free (3) with exactly 3 policies
    mockUserFindUnique.mockResolvedValue({
      plan: 'free',
      trialEndsAt: null,
    });

    mockPolicyFindMany.mockResolvedValue([
      { id: 'policy-1' },
      { id: 'policy-2' },
      { id: 'policy-3' },
    ]);

    const result = await getPolicyFreezeStatus('user-1');

    expect(result.frozenCount).toBe(0);
    // All policies should remain active
    expect(result.frozenPolicyIds.size).toBe(0);
  });

  it('should freeze correct policies after significant downgrade', async () => {
    // User had pro plan (25 policies) and downgraded to free (3 policies)
    // With 10 policies, 7 should be frozen
    mockUserFindUnique.mockResolvedValue({
      plan: 'free',
      trialEndsAt: null,
    });

    const policies = Array.from({ length: 10 }, (_, i) => ({
      id: `policy-${i + 1}`,
    }));

    mockPolicyFindMany.mockResolvedValue(policies);

    const result = await getPolicyFreezeStatus('user-1');

    expect(result.limit).toBe(3);
    expect(result.totalPolicies).toBe(10);
    expect(result.frozenCount).toBe(7);

    // First 3 should be active
    expect(result.frozenPolicyIds.has('policy-1')).toBe(false);
    expect(result.frozenPolicyIds.has('policy-2')).toBe(false);
    expect(result.frozenPolicyIds.has('policy-3')).toBe(false);

    // Rest should be frozen
    for (let i = 4; i <= 10; i++) {
      expect(result.frozenPolicyIds.has(`policy-${i}`)).toBe(true);
    }
  });
});

describe('getBatchPolicyFreezeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty map for empty user IDs', async () => {
    const result = await getBatchPolicyFreezeStatus([]);

    expect(result.size).toBe(0);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('should deduplicate user IDs', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'user-1', plan: 'team', trialEndsAt: null },
    ]);

    await getBatchPolicyFreezeStatus(['user-1', 'user-1', 'user-1']);

    // 应该只查询一次，且只包含去重后的用户 ID
    expect(mockUserFindMany).toHaveBeenCalledTimes(1);
    const callArgs = mockUserFindMany.mock.calls[0][0];
    expect(callArgs.where.id.in).toHaveLength(1);
    expect(callArgs.where.id.in).toContain('user-1');
  });

  it('should return empty set for unlimited plan users without policy query', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'team-user', plan: 'team', trialEndsAt: null },
      { id: 'enterprise-user', plan: 'enterprise', trialEndsAt: null },
    ]);

    const result = await getBatchPolicyFreezeStatus(['team-user', 'enterprise-user']);

    expect(result.size).toBe(2);
    expect(result.get('team-user')?.size).toBe(0);
    expect(result.get('enterprise-user')?.size).toBe(0);
    // 无限制套餐不应该查询策略
    expect(mockPolicyFindMany).not.toHaveBeenCalled();
  });

  it('should calculate frozen policies for limited plan users', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'free-user', plan: 'free', trialEndsAt: null },
    ]);

    // free 用户有 5 个策略，限制为 3，应该冻结 2 个
    mockPolicyFindMany.mockResolvedValue([
      { id: 'policy-1', userId: 'free-user' },
      { id: 'policy-2', userId: 'free-user' },
      { id: 'policy-3', userId: 'free-user' },
      { id: 'policy-4', userId: 'free-user' },
      { id: 'policy-5', userId: 'free-user' },
    ]);

    const result = await getBatchPolicyFreezeStatus(['free-user']);

    expect(result.size).toBe(1);
    const frozenIds = result.get('free-user');
    expect(frozenIds?.size).toBe(2);
    expect(frozenIds?.has('policy-4')).toBe(true);
    expect(frozenIds?.has('policy-5')).toBe(true);
    // 前 3 个策略应该是活跃的
    expect(frozenIds?.has('policy-1')).toBe(false);
    expect(frozenIds?.has('policy-2')).toBe(false);
    expect(frozenIds?.has('policy-3')).toBe(false);
  });

  it('should handle mixed plan users correctly', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'free-user', plan: 'free', trialEndsAt: null },
      { id: 'team-user', plan: 'team', trialEndsAt: null },
      { id: 'pro-user', plan: 'pro', trialEndsAt: null },
    ]);

    // 只为有限制的用户返回策略
    mockPolicyFindMany.mockResolvedValue([
      // free-user 的策略（limit=3，有 4 个）
      { id: 'free-p1', userId: 'free-user' },
      { id: 'free-p2', userId: 'free-user' },
      { id: 'free-p3', userId: 'free-user' },
      { id: 'free-p4', userId: 'free-user' },
      // pro-user 的策略（limit=25，有 2 个，不冻结）
      { id: 'pro-p1', userId: 'pro-user' },
      { id: 'pro-p2', userId: 'pro-user' },
    ]);

    const result = await getBatchPolicyFreezeStatus(['free-user', 'team-user', 'pro-user']);

    expect(result.size).toBe(3);

    // team-user 无限制，空集合
    expect(result.get('team-user')?.size).toBe(0);

    // pro-user 未超限，空集合
    expect(result.get('pro-user')?.size).toBe(0);

    // free-user 超限 1 个
    expect(result.get('free-user')?.size).toBe(1);
    expect(result.get('free-user')?.has('free-p4')).toBe(true);
  });

  it('should treat expired trial as free plan', async () => {
    const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Yesterday

    mockUserFindMany.mockResolvedValue([
      { id: 'expired-trial', plan: 'trial', trialEndsAt: expiredDate },
    ]);

    // 过期 trial 降级为 free（limit=3），有 5 个策略
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1', userId: 'expired-trial' },
      { id: 'p2', userId: 'expired-trial' },
      { id: 'p3', userId: 'expired-trial' },
      { id: 'p4', userId: 'expired-trial' },
      { id: 'p5', userId: 'expired-trial' },
    ]);

    const result = await getBatchPolicyFreezeStatus(['expired-trial']);

    const frozenIds = result.get('expired-trial');
    expect(frozenIds?.size).toBe(2);
    expect(frozenIds?.has('p4')).toBe(true);
    expect(frozenIds?.has('p5')).toBe(true);
  });

  it('should treat active trial as trial plan', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow

    mockUserFindMany.mockResolvedValue([
      { id: 'active-trial', plan: 'trial', trialEndsAt: futureDate },
    ]);

    // 活跃 trial（limit=25），有 5 个策略，不冻结
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1', userId: 'active-trial' },
      { id: 'p2', userId: 'active-trial' },
      { id: 'p3', userId: 'active-trial' },
      { id: 'p4', userId: 'active-trial' },
      { id: 'p5', userId: 'active-trial' },
    ]);

    const result = await getBatchPolicyFreezeStatus(['active-trial']);

    const frozenIds = result.get('active-trial');
    expect(frozenIds?.size).toBe(0);
  });

  it('should handle user with no policies', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'empty-user', plan: 'free', trialEndsAt: null },
    ]);

    mockPolicyFindMany.mockResolvedValue([]);

    const result = await getBatchPolicyFreezeStatus(['empty-user']);

    expect(result.get('empty-user')?.size).toBe(0);
  });

  it('should handle unknown plan as free', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'unknown-user', plan: 'unknown-plan', trialEndsAt: null },
    ]);

    // 未知套餐降级为 free（limit=3），有 4 个策略
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1', userId: 'unknown-user' },
      { id: 'p2', userId: 'unknown-user' },
      { id: 'p3', userId: 'unknown-user' },
      { id: 'p4', userId: 'unknown-user' },
    ]);

    const result = await getBatchPolicyFreezeStatus(['unknown-user']);

    const frozenIds = result.get('unknown-user');
    expect(frozenIds?.size).toBe(1);
    expect(frozenIds?.has('p4')).toBe(true);
  });
});

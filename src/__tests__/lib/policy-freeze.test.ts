import { describe, it, expect, vi, beforeEach } from 'vitest';

// Define named mock functions so we can control them per test
const mockUserFindFirst = vi.fn();
const mockUserFindMany = vi.fn();
const mockPolicyFindMany = vi.fn();
const mockSelectFrom = vi.fn();
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      users: {
        findFirst: (...args: unknown[]) => mockUserFindFirst(...args),
        findMany: (...args: unknown[]) => mockUserFindMany(...args),
      },
      policies: {
        findMany: (...args: unknown[]) => mockPolicyFindMany(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
  },
  users: { id: {}, plan: {}, trialEndsAt: {} },
  policies: { id: {}, userId: {}, updatedAt: {}, groupId: {} },
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

import {
  getPolicyFreezeStatus,
  isPolicyFrozen,
  addFreezeStatusToPolicies,
  getBatchPolicyFreezeStatus,
} from '@/lib/policy-freeze';

// Helper to setup db.select chain for count queries
function setupSelectCount(count: number) {
  const where = vi.fn().mockResolvedValue([{ count }]);
  const from = vi.fn().mockReturnValue({ where });
  mockSelect.mockReturnValue({ from });
}

describe('getPolicyFreezeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset select mock
    mockSelect.mockReturnValue({ from: mockSelectFrom });
  });

  it('should return zeros and empty set when user is not found', async () => {
    mockUserFindFirst.mockResolvedValue(undefined);

    const result = await getPolicyFreezeStatus('nonexistent-user');

    expect(result).toEqual({
      limit: 0,
      totalPolicies: 0,
      frozenCount: 0,
      frozenPolicyIds: new Set(),
    });
  });

  it('should return no frozen policies for unlimited plan (team)', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'team', trialEndsAt: null });
    setupSelectCount(10);

    const result = await getPolicyFreezeStatus('user-1');

    expect(result.limit).toBe(-1);
    expect(result.frozenCount).toBe(0);
    expect(result.frozenPolicyIds.size).toBe(0);
    expect(result.totalPolicies).toBe(10);
  });

  it('should return no frozen policies when within limit', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    // free plan allows 3 policies, user has 2
    mockPolicyFindMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

    const result = await getPolicyFreezeStatus('user-1');

    expect(result.limit).toBe(3);
    expect(result.totalPolicies).toBe(2);
    expect(result.frozenCount).toBe(0);
    expect(result.frozenPolicyIds.size).toBe(0);
  });

  it('should freeze policies beyond the limit, oldest first', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    // free plan allows 3, user has 5
    // First 3 (by updatedAt desc) are active, last 2 are frozen
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' },
      { id: 'p4' }, { id: 'p5' },
    ]);

    const result = await getPolicyFreezeStatus('user-1');

    expect(result.limit).toBe(3);
    expect(result.totalPolicies).toBe(5);
    expect(result.frozenCount).toBe(2);
    expect(result.frozenPolicyIds.has('p4')).toBe(true);
    expect(result.frozenPolicyIds.has('p5')).toBe(true);
    expect(result.frozenPolicyIds.has('p1')).toBe(false);
  });

  it('should treat expired trial as free plan', async () => {
    const pastDate = new Date('2020-01-01');
    mockUserFindFirst.mockResolvedValue({ plan: 'trial', trialEndsAt: pastDate });
    // free plan allows 3, user has 4
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' },
    ]);

    const result = await getPolicyFreezeStatus('user-1');

    // Should use free plan limit (3), not trial (25)
    expect(result.limit).toBe(3);
    expect(result.frozenCount).toBe(1);
    expect(result.frozenPolicyIds.has('p4')).toBe(true);
  });

  it('should use unknown plan as free', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'unknown_plan', trialEndsAt: null });
    mockPolicyFindMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);

    const result = await getPolicyFreezeStatus('user-1');

    expect(result.limit).toBe(3); // falls back to free
  });
});

describe('isPolicyFrozen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockSelectFrom });
  });

  it('should return isFrozen=false and zeroed counts when user is not found', async () => {
    mockUserFindFirst.mockResolvedValue(undefined);

    const result = await isPolicyFrozen('nonexistent', 'policy-1');

    expect(result.isFrozen).toBe(false);
    expect(result.activePoliciesLimit).toBe(0);
    expect(result.totalPolicies).toBe(0);
    expect(result.frozenCount).toBe(0);
  });

  it('should return isFrozen=false for unlimited plan users', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'team', trialEndsAt: null });
    setupSelectCount(15);

    const result = await isPolicyFrozen('user-1', 'any-policy');

    expect(result.isFrozen).toBe(false);
    expect(result.activePoliciesLimit).toBe(-1);
    expect(result.totalPolicies).toBe(15);
  });

  it('should return isFrozen=false when total policies is within limit', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    // total count = 2 (within free limit of 3)
    setupSelectCount(2);
    mockPolicyFindMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);

    const result = await isPolicyFrozen('user-1', 'p1');

    expect(result.isFrozen).toBe(false);
    expect(result.frozenCount).toBe(0);
  });

  it('should return isFrozen=true for a policy beyond the limit', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    // total = 5, limit = 3, active set = [p1, p2, p3]
    setupSelectCount(5);
    mockPolicyFindMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);

    const result = await isPolicyFrozen('user-1', 'p4');

    expect(result.isFrozen).toBe(true);
    expect(result.frozenCount).toBe(2);
    expect(result.reason).toContain('3 policies');
    expect(result.reason).toContain('5');
  });

  it('should return isFrozen=false for a policy that is in the active set', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    setupSelectCount(5);
    mockPolicyFindMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);

    const result = await isPolicyFrozen('user-1', 'p2');

    expect(result.isFrozen).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('should include reason message for frozen policy', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    setupSelectCount(4);
    mockPolicyFindMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);

    const result = await isPolicyFrozen('user-1', 'frozen-policy');

    expect(result.isFrozen).toBe(true);
    expect(result.reason).toBeDefined();
    expect(typeof result.reason).toBe('string');
  });
});

describe('addFreezeStatusToPolicies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockSelectFrom });
  });

  it('should mark frozen policies with isFrozen=true', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    // free plan limit=3, user has 5 policies, p4 and p5 are frozen
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' },
    ]);

    const policiesList = [
      { id: 'p1', name: 'Policy 1' },
      { id: 'p4', name: 'Policy 4' },
      { id: 'p5', name: 'Policy 5' },
    ];

    const result = await addFreezeStatusToPolicies('user-1', policiesList);

    expect(result).toHaveLength(3);
    expect(result.find(p => p.id === 'p1')?.isFrozen).toBe(false);
    expect(result.find(p => p.id === 'p4')?.isFrozen).toBe(true);
    expect(result.find(p => p.id === 'p5')?.isFrozen).toBe(true);
  });

  it('should preserve all original policy properties', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    mockPolicyFindMany.mockResolvedValue([{ id: 'p1' }]);

    const policiesList = [{ id: 'p1', name: 'Test', content: 'Module X.' }];
    const result = await addFreezeStatusToPolicies('user-1', policiesList);

    expect(result[0].name).toBe('Test');
    expect(result[0].content).toBe('Module X.');
    expect(result[0].isFrozen).toBe(false);
  });

  it('should return empty array when given empty list', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'free', trialEndsAt: null });
    mockPolicyFindMany.mockResolvedValue([]);

    const result = await addFreezeStatusToPolicies('user-1', []);

    expect(result).toEqual([]);
  });

  it('should mark all policies unfrozen for unlimited plan', async () => {
    mockUserFindFirst.mockResolvedValue({ plan: 'team', trialEndsAt: null });
    setupSelectCount(10);

    const policiesList = [
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' },
    ];

    const result = await addFreezeStatusToPolicies('user-1', policiesList);

    expect(result.every(p => p.isFrozen === false)).toBe(true);
  });
});

describe('getBatchPolicyFreezeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty map for empty userIds array', async () => {
    const result = await getBatchPolicyFreezeStatus([]);

    expect(result.size).toBe(0);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('should return empty frozen sets for unlimited plan users', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'user-1', plan: 'team', trialEndsAt: null },
      { id: 'user-2', plan: 'enterprise', trialEndsAt: null },
    ]);

    const result = await getBatchPolicyFreezeStatus(['user-1', 'user-2']);

    expect(result.get('user-1')).toEqual(new Set());
    expect(result.get('user-2')).toEqual(new Set());
    // Should not query policies for unlimited users
    expect(mockPolicyFindMany).not.toHaveBeenCalled();
  });

  it('should compute frozen policy IDs for limited plan users', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'user-1', plan: 'free', trialEndsAt: null },
    ]);
    // free plan limit = 3, user has 5 policies
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1', userId: 'user-1' },
      { id: 'p2', userId: 'user-1' },
      { id: 'p3', userId: 'user-1' },
      { id: 'p4', userId: 'user-1' },
      { id: 'p5', userId: 'user-1' },
    ]);

    const result = await getBatchPolicyFreezeStatus(['user-1']);

    const frozenIds = result.get('user-1');
    expect(frozenIds).toBeDefined();
    expect(frozenIds!.has('p4')).toBe(true);
    expect(frozenIds!.has('p5')).toBe(true);
    expect(frozenIds!.has('p1')).toBe(false);
  });

  it('should deduplicate input userIds', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'user-1', plan: 'free', trialEndsAt: null },
    ]);
    mockPolicyFindMany.mockResolvedValue([]);

    await getBatchPolicyFreezeStatus(['user-1', 'user-1', 'user-1']);

    // Should query users only once
    expect(mockUserFindMany).toHaveBeenCalledTimes(1);
  });

  it('should handle mix of limited and unlimited users', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'user-free', plan: 'free', trialEndsAt: null },
      { id: 'user-team', plan: 'team', trialEndsAt: null },
    ]);
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1', userId: 'user-free' },
      { id: 'p2', userId: 'user-free' },
      { id: 'p3', userId: 'user-free' },
      { id: 'p4', userId: 'user-free' }, // frozen
    ]);

    const result = await getBatchPolicyFreezeStatus(['user-free', 'user-team']);

    const freeFrozen = result.get('user-free');
    expect(freeFrozen!.has('p4')).toBe(true);
    expect(freeFrozen!.has('p1')).toBe(false);

    const teamFrozen = result.get('user-team');
    expect(teamFrozen).toEqual(new Set()); // unlimited, no frozen
  });

  it('should return empty frozen set when limited user is within limit', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'user-1', plan: 'free', trialEndsAt: null },
    ]);
    // free limit = 3, user has 2
    mockPolicyFindMany.mockResolvedValue([
      { id: 'p1', userId: 'user-1' },
      { id: 'p2', userId: 'user-1' },
    ]);

    const result = await getBatchPolicyFreezeStatus(['user-1']);

    expect(result.get('user-1')).toEqual(new Set());
  });
});

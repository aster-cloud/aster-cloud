import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mocks that need to be referenced inside vi.mock factories
const {
  mockInsertOnConflict,
  mockInsertValues,
  mockInsert,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
  mockSelect,
} = vi.hoisted(() => {
  const mockInsertOnConflict = vi.fn().mockResolvedValue(undefined);
  const mockInsertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockInsertOnConflict });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockSelect = vi.fn();

  return {
    mockInsertOnConflict,
    mockInsertValues,
    mockInsert,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    mockSelect,
  };
});

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(),
      },
      usageRecords: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  },
  users: { id: {}, plan: {}, trialEndsAt: {} },
  usageRecords: { id: {}, userId: {}, type: {}, count: {}, period: {} },
  policies: { id: {}, userId: {} },
}));

import { db } from '@/lib/prisma';
import { checkUsageLimit, recordUsage, getUsageStats, hasFeatureAccess } from '@/lib/usage';

// Helper to setup db.select chain for policy count queries
function setupSelectCount(count: number) {
  const mockWhere = vi.fn().mockResolvedValue([{ count }]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

function mockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: null,
    image: null,
    passwordHash: null,
    failedLoginAttempts: 0,
    lastFailedLoginAt: null,
    lockedUntil: null,
    lockoutCount: 0,
    plan: 'free' as const,
    stripeCustomerId: null,
    subscriptionId: null,
    subscriptionStatus: null,
    trialStartedAt: null,
    trialEndsAt: null,
    onboardingUseCase: null,
    onboardingGoals: null,
    onboardingCompletedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function mockUsageRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'usage-1',
    userId: 'user-1',
    type: 'execution' as const,
    count: 0,
    period: '2024-01',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('Usage Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset insert/update chains
    mockInsertOnConflict.mockResolvedValue(undefined);
    mockInsertValues.mockReturnValue({ onConflictDoUpdate: mockInsertOnConflict });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockUpdateWhere.mockResolvedValue(undefined);
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  describe('checkUsageLimit', () => {
    it('should return not allowed when user is not found', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);

      const result = await checkUsageLimit('nonexistent-user', 'execution');

      expect(result).toEqual({ allowed: false, message: 'User not found' });
    });

    it('should return allowed with unlimited remaining for unlimited plan (enterprise)', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'enterprise' }));

      const result = await checkUsageLimit('user-1', 'execution');

      // enterprise plan has -1 executions limit (unlimited)
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
      expect(result.remaining).toBe(-1);
    });

    it('should return allowed with remaining count when under limit', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser());
      vi.mocked(db.query.usageRecords.findFirst).mockResolvedValue(mockUsageRecord({ count: 50 }));

      const result = await checkUsageLimit('user-1', 'execution');

      // free plan: 100 executions limit, 50 used
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(50);
    });

    it('should return not allowed with message when at limit', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser());
      vi.mocked(db.query.usageRecords.findFirst).mockResolvedValue(mockUsageRecord({ count: 100 }));

      const result = await checkUsageLimit('user-1', 'execution');

      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(100);
      expect(result.remaining).toBe(0);
      expect(result.message).toContain('100');
    });

    it('should treat expired trial as free plan', async () => {
      const pastDate = new Date('2020-01-01');
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'trial', trialEndsAt: pastDate }));
      // free plan: 100 executions
      vi.mocked(db.query.usageRecords.findFirst).mockResolvedValue(mockUsageRecord({ count: 0 }));

      const result = await checkUsageLimit('user-1', 'execution');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100); // free plan limit, not trial (5000)
      // Also verify user plan was downgraded
      expect(db.update).toHaveBeenCalled();
    });

    it('should return allowed with unlimited for usage types without limit mapping (pii_scan)', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser());

      const result = await checkUsageLimit('user-1', 'pii_scan');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
      expect(result.remaining).toBe(-1);
    });

    it('should count 0 usage when no usage record exists for period', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser());
      vi.mocked(db.query.usageRecords.findFirst).mockResolvedValue(undefined);

      const result = await checkUsageLimit('user-1', 'execution');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100);
    });

    it('should return not allowed for api_call when free plan has 0 api quota', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser());
      vi.mocked(db.query.usageRecords.findFirst).mockResolvedValue(mockUsageRecord({ count: 0 }));

      const result = await checkUsageLimit('user-1', 'api_call');

      // free plan: apiCalls = 0, so count (0) >= limit (0) → not allowed
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
    });
  });

  describe('recordUsage', () => {
    it('should insert or upsert usage record for the current period', async () => {
      await recordUsage('user-1', 'execution');

      expect(mockInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'execution',
          count: 1,
        })
      );
      expect(mockInsertOnConflict).toHaveBeenCalled();
    });

    it('should record custom count when provided', async () => {
      await recordUsage('user-1', 'api_call', 5);

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: 'api_call',
          count: 5,
        })
      );
    });

    it('should include a period in YYYY-MM format', async () => {
      await recordUsage('user-1', 'pii_scan');

      const callArgs = mockInsertValues.mock.calls[0][0];
      expect(callArgs.period).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('getUsageStats', () => {
    it('should return usage stats with plan limits and current usage', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'pro' }));
      vi.mocked(db.query.usageRecords.findMany).mockResolvedValue([
        mockUsageRecord({ type: 'execution', count: 100 }),
        mockUsageRecord({ type: 'api_call', count: 50 }),
      ]);
      // policy count query
      setupSelectCount(10);

      const result = await getUsageStats('user-1');

      expect(result.plan).toBe('pro');
      expect(result.usage.executions).toBe(100);
      expect(result.usage.apiCalls).toBe(50);
      expect(result.usage.policies).toBe(10);
      expect(result.usage.policiesLimit).toBe(25); // pro plan limit
      expect(result.usage.executionsLimit).toBe(5000);
      expect(result.features.apiAccess).toBe(true);
    });

    it('should return trial days left for active trial users', async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'trial', trialEndsAt: futureDate }));
      vi.mocked(db.query.usageRecords.findMany).mockResolvedValue([]);
      setupSelectCount(0);

      const result = await getUsageStats('user-1');

      expect(result.plan).toBe('trial');
      expect(result.trialDaysLeft).toBeGreaterThan(0);
      expect(result.trialDaysLeft).toBeLessThanOrEqual(7);
    });

    it('should downgrade expired trial to free and return null trial days left', async () => {
      const pastDate = new Date('2020-01-01');
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'trial', trialEndsAt: pastDate }));
      vi.mocked(db.query.usageRecords.findMany).mockResolvedValue([]);
      setupSelectCount(0);

      const result = await getUsageStats('user-1');

      expect(result.plan).toBe('free');
      expect(result.trialDaysLeft).toBeNull();
      expect(db.update).toHaveBeenCalled();
    });

    it('should default to free plan when user has unknown plan', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'unknown_plan' as any }));
      vi.mocked(db.query.usageRecords.findMany).mockResolvedValue([]);
      setupSelectCount(0);

      const result = await getUsageStats('user-1');

      expect(result.plan).toBe('free');
    });

    it('should return 0 for usage types not present in records', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'pro' }));
      vi.mocked(db.query.usageRecords.findMany).mockResolvedValue([]);
      setupSelectCount(5);

      const result = await getUsageStats('user-1');

      expect(result.usage.executions).toBe(0);
      expect(result.usage.piiScans).toBe(0);
      expect(result.usage.complianceReports).toBe(0);
      expect(result.usage.apiCalls).toBe(0);
    });
  });

  describe('hasFeatureAccess', () => {
    it('should return false when user is not found', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);

      const result = await hasFeatureAccess('nonexistent', 'apiAccess');

      expect(result).toBe(false);
    });

    it('should return false for free plan API access', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser());

      const result = await hasFeatureAccess('user-1', 'apiAccess');

      expect(result).toBe(false);
    });

    it('should return true for pro plan API access', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'pro' }));

      const result = await hasFeatureAccess('user-1', 'apiAccess');

      expect(result).toBe(true);
    });

    it('should return false for free plan compliance reports', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser());

      const result = await hasFeatureAccess('user-1', 'complianceReports');

      expect(result).toBe(false);
    });

    it('should return true for team plan teamFeatures', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'team' }));

      const result = await hasFeatureAccess('user-1', 'teamFeatures');

      expect(result).toBe(true);
    });

    it('should treat expired trial as free plan', async () => {
      const pastDate = new Date('2020-01-01');
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'trial', trialEndsAt: pastDate }));

      // trial has apiAccess=true, but expired trial → free which has apiAccess=false
      const result = await hasFeatureAccess('user-1', 'apiAccess');

      expect(result).toBe(false);
    });
  });
});

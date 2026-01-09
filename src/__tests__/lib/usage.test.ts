import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma - use hoisted mock pattern
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    usageRecord: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    policy: {
      count: vi.fn(),
    },
  },
}));

// Import after mocking
import { checkUsageLimit, recordUsage, getUsageStats, hasFeatureAccess } from '@/lib/usage';
import { prisma } from '@/lib/prisma';

// Cast prisma to mocked version
const mockPrisma = vi.mocked(prisma);

describe('Usage Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkUsageLimit', () => {
    it('should allow unlimited executions for pro users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'pro',
        trialEndsAt: null,
      });

      const result = await checkUsageLimit('user-1', 'execution');

      expect(result.allowed).toBe(true);
    });

    it('should enforce limits for free users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      mockPrisma.usageRecord.findUnique.mockResolvedValue({
        count: 100, // At limit
      });

      const result = await checkUsageLimit('user-1', 'execution');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.message).toContain('limit');
    });

    it('should allow when under limit for free users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      mockPrisma.usageRecord.findUnique.mockResolvedValue({
        count: 50, // Under limit
      });

      const result = await checkUsageLimit('user-1', 'execution');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
    });

    it('should downgrade expired trial users to free', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1); // Yesterday

      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'trial',
        trialEndsAt: expiredDate,
      });

      mockPrisma.usageRecord.findUnique.mockResolvedValue({
        count: 100,
      });

      mockPrisma.user.update.mockResolvedValue({});

      const result = await checkUsageLimit('user-1', 'execution');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { plan: 'free' },
      });
      expect(result.allowed).toBe(false);
    });

    it('should return user not found for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await checkUsageLimit('non-existent', 'execution');

      expect(result.allowed).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('recordUsage', () => {
    it('should upsert usage record', async () => {
      mockPrisma.usageRecord.upsert.mockResolvedValue({});

      await recordUsage('user-1', 'execution', 1);

      expect(mockPrisma.usageRecord.upsert).toHaveBeenCalled();
      const call = mockPrisma.usageRecord.upsert.mock.calls[0][0];
      expect(call.update.count.increment).toBe(1);
      expect(call.create.count).toBe(1);
    });

    it('should support custom count', async () => {
      mockPrisma.usageRecord.upsert.mockResolvedValue({});

      await recordUsage('user-1', 'api_call', 5);

      const call = mockPrisma.usageRecord.upsert.mock.calls[0][0];
      expect(call.update.count.increment).toBe(5);
      expect(call.create.count).toBe(5);
    });
  });

  describe('getUsageStats', () => {
    it('should return complete usage stats for user with data', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'pro',
        trialEndsAt: null,
      });

      mockPrisma.usageRecord.findMany.mockResolvedValue([
        { type: 'execution', count: 50 },
        { type: 'api_call', count: 100 },
        { type: 'pii_scan', count: 10 },
      ]);

      mockPrisma.policy.count.mockResolvedValue(5);

      const stats = await getUsageStats('user-1');

      expect(stats.plan).toBe('pro');
      expect(stats.trialDaysLeft).toBeNull();
      expect(stats.usage.executions).toBe(50);
      expect(stats.usage.apiCalls).toBe(100);
      expect(stats.usage.piiScans).toBe(10);
      expect(stats.usage.policies).toBe(5);
      expect(stats.features.apiAccess).toBe(true);
    });

    it('should return empty usage for user with no records', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      mockPrisma.usageRecord.findMany.mockResolvedValue([]);
      mockPrisma.policy.count.mockResolvedValue(0);

      const stats = await getUsageStats('user-1');

      expect(stats.plan).toBe('free');
      expect(stats.usage.executions).toBe(0);
      expect(stats.usage.apiCalls).toBe(0);
      expect(stats.usage.policies).toBe(0);
    });

    it('should calculate trial days remaining', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5); // 5 days from now

      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'trial',
        trialEndsAt: futureDate,
      });

      mockPrisma.usageRecord.findMany.mockResolvedValue([]);
      mockPrisma.policy.count.mockResolvedValue(0);

      const stats = await getUsageStats('user-1');

      expect(stats.plan).toBe('trial');
      expect(stats.trialDaysLeft).toBeGreaterThanOrEqual(4);
      expect(stats.trialDaysLeft).toBeLessThanOrEqual(6);
    });

    it('should downgrade expired trial and return free plan stats', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1); // Yesterday

      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'trial',
        trialEndsAt: expiredDate,
      });

      mockPrisma.usageRecord.findMany.mockResolvedValue([]);
      mockPrisma.policy.count.mockResolvedValue(0);
      mockPrisma.user.update.mockResolvedValue({});

      const stats = await getUsageStats('user-1');

      expect(stats.plan).toBe('free');
      expect(stats.trialDaysLeft).toBeNull();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { plan: 'free' },
      });
    });

    it('should handle user not found gracefully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.usageRecord.findMany.mockResolvedValue([]);
      mockPrisma.policy.count.mockResolvedValue(0);

      const stats = await getUsageStats('non-existent');

      // 用户不存在时使用默认 free 计划
      expect(stats.plan).toBe('free');
    });
  });

  describe('hasFeatureAccess', () => {
    it('should return false for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await hasFeatureAccess('non-existent', 'apiAccess');

      expect(result).toBe(false);
    });

    it('should return true for boolean capability enabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'pro',
        trialEndsAt: null,
      });

      const result = await hasFeatureAccess('user-1', 'apiAccess');

      expect(result).toBe(true);
    });

    it('should return false for boolean capability disabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'free',
        trialEndsAt: null,
      });

      const result = await hasFeatureAccess('user-1', 'apiAccess');

      expect(result).toBe(false);
    });

    it('should handle string capability as truthy', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'pro',
        trialEndsAt: null,
      });

      // piiDetection 是字符串类型 ('basic' | 'advanced')，应返回 Boolean('advanced') = true
      const result = await hasFeatureAccess('user-1', 'piiDetection');

      expect(result).toBe(true);
    });

    it('should downgrade expired trial before checking access', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1);

      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'trial',
        trialEndsAt: expiredDate,
      });

      mockPrisma.user.update.mockResolvedValue({});

      const result = await hasFeatureAccess('user-1', 'apiAccess');

      // 过期 trial 降级为 free，free 没有 apiAccess
      expect(result).toBe(false);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { plan: 'free' },
      });
    });

    it('should return true for active trial user with feature', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'trial',
        trialEndsAt: futureDate,
      });

      const result = await hasFeatureAccess('user-1', 'apiAccess');

      // trial 计划有 apiAccess
      expect(result).toBe(true);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});

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
import { checkUsageLimit, recordUsage } from '@/lib/usage';
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
});

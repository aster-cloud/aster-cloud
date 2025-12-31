import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// Mock Prisma - use hoisted mock pattern
vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import {
  generateApiKey,
  hashApiKey,
  createApiKey,
  validateApiKey,
  listApiKeys,
  revokeApiKey,
} from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

// Cast prisma to mocked version
const mockPrisma = vi.mocked(prisma);

describe('API Keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateApiKey', () => {
    it('should generate a key with correct format', () => {
      const { key, hash, prefix } = generateApiKey();

      expect(key).toMatch(/^ak_[a-f0-9]{64}$/);
      expect(prefix).toHaveLength(8);
      expect(hash).toHaveLength(64); // SHA256 hex
    });

    it('should generate unique keys', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();

      expect(key1.key).not.toBe(key2.key);
      expect(key1.hash).not.toBe(key2.hash);
    });
  });

  describe('hashApiKey', () => {
    it('should hash consistently', () => {
      const key = 'ak_test123';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it('should produce valid SHA256 hash', () => {
      const key = 'ak_test123';
      const hash = hashApiKey(key);
      const expectedHash = createHash('sha256').update(key).digest('hex');

      expect(hash).toBe(expectedHash);
    });
  });

  describe('createApiKey', () => {
    it('should create and store a new API key', async () => {
      mockPrisma.apiKey.create.mockResolvedValue({
        id: 'key-id',
        prefix: 'abc12345',
        name: 'Test Key',
        createdAt: new Date(),
      });

      const result = await createApiKey('user-1', 'Test Key');

      expect(result.name).toBe('Test Key');
      expect(result.key).toMatch(/^ak_/);
      expect(result.id).toBe('key-id');
      expect(mockPrisma.apiKey.create).toHaveBeenCalled();
    });
  });

  describe('validateApiKey', () => {
    it('should reject invalid format', async () => {
      const result = await validateApiKey('invalid-key');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('format');
    });

    it('should reject non-existent keys', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue(null);

      const result = await validateApiKey('ak_nonexistent123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('should reject revoked keys', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-id',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: null,
        user: { id: 'user-1', plan: 'pro', trialEndsAt: null },
      });

      const result = await validateApiKey('ak_test123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('revoked');
    });

    it('should reject expired keys', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1);

      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-id',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: expiredDate,
        user: { id: 'user-1', plan: 'pro', trialEndsAt: null },
      });

      const result = await validateApiKey('ak_test123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should reject free users', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-id',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: null,
        user: { id: 'user-1', plan: 'free', trialEndsAt: null },
      });

      const result = await validateApiKey('ak_test123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('subscription');
    });

    it('should accept valid pro user keys', async () => {
      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-id',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: null,
        user: { id: 'user-1', plan: 'pro', trialEndsAt: null },
      });

      mockPrisma.apiKey.update.mockResolvedValue({});

      const result = await validateApiKey('ak_test123');

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.apiKeyId).toBe('key-id');
      expect(mockPrisma.apiKey.update).toHaveBeenCalled(); // lastUsedAt updated
    });

    it('should reject expired trial users', async () => {
      const expiredTrial = new Date();
      expiredTrial.setDate(expiredTrial.getDate() - 1);

      mockPrisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-id',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: null,
        user: { id: 'user-1', plan: 'trial', trialEndsAt: expiredTrial },
      });

      const result = await validateApiKey('ak_test123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Trial');
    });
  });

  describe('listApiKeys', () => {
    it('should return non-revoked keys', async () => {
      mockPrisma.apiKey.findMany.mockResolvedValue([
        { id: '1', name: 'Key 1', prefix: 'abc12345' },
        { id: '2', name: 'Key 2', prefix: 'def67890' },
      ]);

      const result = await listApiKeys('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
        })
      );
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke an existing key', async () => {
      mockPrisma.apiKey.updateMany.mockResolvedValue({ count: 1 });

      const result = await revokeApiKey('user-1', 'key-id');

      expect(result).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      mockPrisma.apiKey.updateMany.mockResolvedValue({ count: 0 });

      const result = await revokeApiKey('user-1', 'non-existent');

      expect(result).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// P0-R18: complete Drizzle mock coverage for api-keys.ts (closes Jan 2026
// migration TODO). Same vi.hoisted pattern as usage.test.ts / compliance.test.ts.
const {
  mockFindFirst,
  mockFindMany,
  mockInsertReturning,
  mockInsertValues,
  mockInsert,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdate,
} = vi.hoisted(() => {
  const mockFindFirst = vi.fn();
  const mockFindMany = vi.fn();

  const mockInsertReturning = vi.fn();
  const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  const mockUpdateReturning = vi.fn();
  // mockUpdateWhere 需要既能 await（validateApiKey 的 lastUsedAt update 不接
  // .returning() 直接 await）又能 .returning()（revokeApiKey 接 .returning()）.
  // 让它返回一个既是 thenable 又有 returning 方法的对象.
  const mockUpdateWhere = vi.fn(() => {
    const p: Promise<undefined> & { returning?: typeof mockUpdateReturning } =
      Promise.resolve(undefined) as Promise<undefined> & {
        returning?: typeof mockUpdateReturning;
      };
    p.returning = mockUpdateReturning;
    return p;
  });
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  return {
    mockFindFirst,
    mockFindMany,
    mockInsertReturning,
    mockInsertValues,
    mockInsert,
    mockUpdateReturning,
    mockUpdateSet,
    mockUpdate,
  };
});

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      apiKeys: {
        findFirst: mockFindFirst,
        findMany: mockFindMany,
      },
    },
    insert: mockInsert,
    update: mockUpdate,
  },
  apiKeys: {
    id: {},
    userId: {},
    key: {},
    name: {},
    prefix: {},
    createdAt: {},
    lastUsedAt: {},
    revokedAt: {},
    expiresAt: {},
  },
  users: {
    id: {},
    plan: {},
    trialEndsAt: {},
  },
}));

import {
  generateApiKey,
  hashApiKey,
  createApiKey,
  validateApiKey,
  listApiKeys,
  revokeApiKey,
  authenticateApiRequest,
} from '@/lib/api-keys';

describe('API Keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Pure functions (kept for regression after R18 expansion)
  // ──────────────────────────────────────────────────────────────────────

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
      expect(hashApiKey(key)).toBe(hashApiKey(key));
    });

    it('should produce valid SHA256 hash', () => {
      const key = 'ak_test123';
      const expectedHash = createHash('sha256').update(key).digest('hex');
      expect(hashApiKey(key)).toBe(expectedHash);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // createApiKey (R18 new)
  // ──────────────────────────────────────────────────────────────────────

  describe('createApiKey', () => {
    it('inserts a new key row and returns the raw key + metadata', async () => {
      const fixedDate = new Date('2026-01-01T00:00:00Z');
      mockInsertReturning.mockResolvedValue([
        {
          id: 'key-id-123',
          userId: 'user-1',
          name: 'My Key',
          prefix: 'abcdef12',
          createdAt: fixedDate,
        },
      ]);

      const result = await createApiKey('user-1', 'My Key');

      expect(result.id).toBe('key-id-123');
      expect(result.name).toBe('My Key');
      expect(result.prefix).toBe('abcdef12');
      expect(result.createdAt).toEqual(fixedDate);
      // raw key returned to caller exactly once
      expect(result.key).toMatch(/^ak_[a-f0-9]{64}$/);
      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsertValues).toHaveBeenCalledTimes(1);
      const insertedRow = (mockInsertValues.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(insertedRow.userId).toBe('user-1');
      expect(insertedRow.name).toBe('My Key');
      // stored value is hash, not raw key
      expect(typeof insertedRow.key).toBe('string');
      expect((insertedRow.key as string).length).toBe(64);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // validateApiKey (R18 new)
  // ──────────────────────────────────────────────────────────────────────

  describe('validateApiKey', () => {
    it('rejects empty key', async () => {
      const r = await validateApiKey('');
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/Invalid API key format/);
    });

    it('rejects key without ak_ prefix', async () => {
      const r = await validateApiKey('sk_wrong_prefix');
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/Invalid API key format/);
    });

    it('rejects when no DB row matches', async () => {
      mockFindFirst.mockResolvedValue(null);
      const r = await validateApiKey('ak_' + 'a'.repeat(64));
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/Invalid API key/);
    });

    it('rejects revoked keys', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'k1',
        userId: 'u1',
        revokedAt: new Date('2025-01-01'),
        expiresAt: null,
        user: { id: 'u1', plan: 'pro', trialEndsAt: null },
      });
      const r = await validateApiKey('ak_' + 'a'.repeat(64));
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/revoked/);
    });

    it('rejects expired keys', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'k1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date('2020-01-01'),
        user: { id: 'u1', plan: 'pro', trialEndsAt: null },
      });
      const r = await validateApiKey('ak_' + 'a'.repeat(64));
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/expired/);
    });

    it('rejects free-plan users', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'k1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: null,
        user: { id: 'u1', plan: 'free', trialEndsAt: null },
      });
      const r = await validateApiKey('ak_' + 'a'.repeat(64));
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/Pro or Team/);
    });

    it('rejects expired trial', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'k1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: null,
        user: {
          id: 'u1',
          plan: 'trial',
          trialEndsAt: new Date('2020-01-01'),
        },
      });
      const r = await validateApiKey('ak_' + 'a'.repeat(64));
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/Trial has expired/);
    });

    it('accepts valid Pro user key and updates lastUsedAt', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'k1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: null,
        user: { id: 'u1', plan: 'pro', trialEndsAt: null },
      });
      const r = await validateApiKey('ak_' + 'a'.repeat(64));
      expect(r.valid).toBe(true);
      expect(r.userId).toBe('u1');
      expect(r.apiKeyId).toBe('k1');
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const setArg = (mockUpdateSet.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(setArg.lastUsedAt).toBeInstanceOf(Date);
    });

    it('accepts valid trial user within window', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'k1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: null,
        user: {
          id: 'u1',
          plan: 'trial',
          trialEndsAt: new Date(Date.now() + 86400000), // tomorrow
        },
      });
      const r = await validateApiKey('ak_' + 'a'.repeat(64));
      expect(r.valid).toBe(true);
      expect(r.userId).toBe('u1');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // listApiKeys (R18 new)
  // ──────────────────────────────────────────────────────────────────────

  describe('listApiKeys', () => {
    it('returns active (non-revoked) keys for user', async () => {
      const rows = [
        {
          id: 'k1',
          name: 'Production',
          prefix: 'abc12345',
          lastUsedAt: new Date('2026-05-01'),
          expiresAt: null,
          createdAt: new Date('2026-04-01'),
        },
        {
          id: 'k2',
          name: 'Staging',
          prefix: 'def67890',
          lastUsedAt: null,
          expiresAt: new Date('2026-12-31'),
          createdAt: new Date('2026-05-15'),
        },
      ];
      mockFindMany.mockResolvedValue(rows);
      const result = await listApiKeys('u1');
      expect(result).toEqual(rows);
      expect(mockFindMany).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when user has no keys', async () => {
      mockFindMany.mockResolvedValue([]);
      const result = await listApiKeys('u1');
      expect(result).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // revokeApiKey (R18 new)
  // ──────────────────────────────────────────────────────────────────────

  describe('revokeApiKey', () => {
    it('returns true when revocation matched a row', async () => {
      mockUpdateReturning.mockResolvedValue([{ id: 'k1' }]);
      const ok = await revokeApiKey('u1', 'k1');
      expect(ok).toBe(true);
      const setArg = (mockUpdateSet.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(setArg.revokedAt).toBeInstanceOf(Date);
    });

    it('returns false when no row matched (e.g. already revoked or wrong user)', async () => {
      mockUpdateReturning.mockResolvedValue([]);
      const ok = await revokeApiKey('u1', 'k1');
      expect(ok).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // authenticateApiRequest (R18 new)
  // ──────────────────────────────────────────────────────────────────────

  describe('authenticateApiRequest', () => {
    function makeReq(authHeader?: string): Request {
      const headers = new Headers();
      if (authHeader) headers.set('authorization', authHeader);
      return new Request('https://example.com/api/v1/policies', {
        method: 'POST',
        headers,
      });
    }

    it('rejects requests with no Authorization header', async () => {
      const r = await authenticateApiRequest(makeReq());
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.status).toBe(401);
        expect(r.error).toMatch(/Authorization header/);
      }
    });

    it('rejects non-Bearer auth schemes', async () => {
      const r = await authenticateApiRequest(makeReq('Basic dXNlcjpwYXNz'));
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.status).toBe(401);
      }
    });

    it('rejects when underlying validation fails', async () => {
      mockFindFirst.mockResolvedValue(null);
      const r = await authenticateApiRequest(
        makeReq('Bearer ak_' + 'a'.repeat(64)),
      );
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.status).toBe(401);
        expect(r.error).toMatch(/Invalid API key/);
      }
    });

    it('returns success with userId + apiKeyId for valid key', async () => {
      mockFindFirst.mockResolvedValue({
        id: 'k1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: null,
        user: { id: 'u1', plan: 'pro', trialEndsAt: null },
      });
      const r = await authenticateApiRequest(
        makeReq('Bearer ak_' + 'a'.repeat(64)),
      );
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.userId).toBe('u1');
        expect(r.apiKeyId).toBe('k1');
      }
    });
  });
});

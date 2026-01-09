import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/api-keys/route';
import { getSession } from '@/lib/auth';
import { hasFeatureAccess } from '@/lib/usage';
import { createApiKey, listApiKeys } from '@/lib/api-keys';

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/usage', () => ({
  hasFeatureAccess: vi.fn(),
}));

vi.mock('@/lib/api-keys', () => ({
  createApiKey: vi.fn(),
  listApiKeys: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockHasFeatureAccess = vi.mocked(hasFeatureAccess);
const mockCreateApiKey = vi.mocked(createApiKey);
const mockListApiKeys = vi.mocked(listApiKeys);

function createPostRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/api-keys', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('API Keys API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    } as unknown as Awaited<ReturnType<typeof getSession>>);
  });

  describe('GET /api/api-keys', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return api keys list on success', async () => {
      mockListApiKeys.mockResolvedValue([
        { id: 'key-1', prefix: 'ak_abc', name: 'Key 1', createdAt: new Date(), lastUsedAt: null },
        { id: 'key-2', prefix: 'ak_def', name: 'Key 2', createdAt: new Date(), lastUsedAt: new Date() },
      ]);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe('key-1');
      expect(mockListApiKeys).toHaveBeenCalledWith('user-1');
    });

    it('should return 500 on internal error', async () => {
      mockListApiKeys.mockRejectedValue(new Error('Database error'));

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('POST /api/api-keys', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await POST(createPostRequest({ name: 'My Key' }));
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 403 when user lacks API access', async () => {
      mockHasFeatureAccess.mockResolvedValue(false);

      const response = await POST(createPostRequest({ name: 'My Key' }));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toContain('API access requires');
      expect(body.upgrade).toBe(true);
    });

    it('should return 400 when name is missing', async () => {
      mockHasFeatureAccess.mockResolvedValue(true);

      const response = await POST(createPostRequest({}));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Name is required');
    });

    it('should return 400 when name is not a string', async () => {
      mockHasFeatureAccess.mockResolvedValue(true);

      const response = await POST(createPostRequest({ name: 123 }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Name is required');
    });

    it('should return 201 and create key on success', async () => {
      mockHasFeatureAccess.mockResolvedValue(true);
      mockCreateApiKey.mockResolvedValue({
        id: 'key-1',
        key: 'ak_test_full_key',
        prefix: 'ak_test',
        name: 'My Key',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      });

      const response = await POST(createPostRequest({ name: 'My Key' }));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.id).toBe('key-1');
      expect(body.key).toBe('ak_test_full_key');
      expect(mockCreateApiKey).toHaveBeenCalledWith('user-1', 'My Key');
    });

    it('should return 500 on internal error', async () => {
      mockHasFeatureAccess.mockResolvedValue(true);
      mockCreateApiKey.mockRejectedValue(new Error('Database error'));

      const response = await POST(createPostRequest({ name: 'My Key' }));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/api-keys/route';
import { getSession } from '@/lib/auth';
import { hasFeatureAccess } from '@/lib/usage';
import { createApiKey } from '@/lib/api-keys';

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

function createRequest(body: Record<string, unknown>) {
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
    } as any);
  });

  it('should reject free plan users', async () => {
    mockHasFeatureAccess.mockResolvedValue(false);

    const response = await POST(createRequest({ name: 'My Key' }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('API access requires');
  });

  it('should allow pro plan users', async () => {
    mockHasFeatureAccess.mockResolvedValue(true);
    mockCreateApiKey.mockResolvedValue({
      id: 'key-1',
      key: 'ak_test',
      prefix: 'ak_test',
      name: 'My Key',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const response = await POST(createRequest({ name: 'My Key' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe('key-1');
    expect(mockCreateApiKey).toHaveBeenCalledWith('user-1', 'My Key');
  });
});

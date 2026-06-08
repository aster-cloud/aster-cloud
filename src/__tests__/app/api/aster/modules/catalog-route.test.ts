import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSession, mockGetModuleCatalog, mockCreatePolicyApiClient } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetModuleCatalog: vi.fn(),
  mockCreatePolicyApiClient: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}));

vi.mock('@/services/policy/policy-api', () => ({
  createPolicyApiClient: mockCreatePolicyApiClient,
}));

describe('GET /api/aster/modules/catalog', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetSession.mockReset();
    mockGetModuleCatalog.mockReset();
    mockCreatePolicyApiClient.mockReset();
    mockCreatePolicyApiClient.mockReturnValue({ getModuleCatalog: mockGetModuleCatalog });
  });

  it('returns 401 when the user is not logged in', async () => {
    mockGetSession.mockResolvedValue(null);

    const { GET } = await import('@/app/api/aster/modules/catalog/route');
    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockCreatePolicyApiClient).not.toHaveBeenCalled();
  });

  it('derives tenant from session and passes catalog through', async () => {
    const catalog = {
      modules: [
        {
          moduleName: 'risk.Scoring',
          functionName: 'computeScore',
          versions: [{ version: 2, publishedAt: '2026-06-08T00:00:00.000Z' }],
        },
      ],
    };
    mockGetSession.mockResolvedValue({ user: { id: 'tenant-1' } });
    mockGetModuleCatalog.mockResolvedValue(catalog);

    const { GET } = await import('@/app/api/aster/modules/catalog/route');
    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockCreatePolicyApiClient).toHaveBeenCalledWith('tenant-1', 'tenant-1');
    expect(await response.json()).toEqual(catalog);
  });
});

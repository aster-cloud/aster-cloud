import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so variables can be referenced in vi.mock factories
const {
  mockReturningInsert,
  mockValuesInsert,
  mockInsert,
  mockReturningUpdate,
  mockWhereUpdate,
  mockSetUpdate,
  mockUpdate,
  mockWhereDelete: _mockWhereDelete,
  mockDelete,
  mockSelectExec,
} = vi.hoisted(() => {
  const mockReturningInsert = vi.fn();
  const mockValuesInsert = vi.fn().mockReturnValue({ returning: mockReturningInsert });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValuesInsert });

  const mockReturningUpdate = vi.fn();
  const mockWhereUpdate = vi.fn().mockReturnValue({ returning: mockReturningUpdate });
  const mockSetUpdate = vi.fn().mockReturnValue({ where: mockWhereUpdate });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSetUpdate });

  const mockWhereDelete = vi.fn().mockResolvedValue(undefined);
  const mockDelete = vi.fn().mockReturnValue({ where: mockWhereDelete });

  const mockSelectExec = vi.fn();

  return {
    mockReturningInsert,
    mockValuesInsert,
    mockInsert,
    mockReturningUpdate,
    mockWhereUpdate,
    mockSetUpdate,
    mockUpdate,
    mockWhereDelete,
    mockDelete,
    mockSelectExec,
  };
});

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/policy-lifecycle', () => ({
  softDeletePolicy: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  invalidatePolicyCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/policy-freeze', () => ({
  getPolicyFreezeStatus: vi.fn(),
  isPolicyFrozen: vi.fn(),
}));

vi.mock('@/services/pii/detector', () => ({
  detectPII: vi.fn().mockReturnValue({ detectedTypes: [] }),
}));

vi.mock('@/lib/usage', () => ({
  checkUsageLimit: vi.fn().mockResolvedValue({ allowed: true }),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      policies: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      policyVersions: {
        findMany: vi.fn(),
      },
      policyGroups: {
        findFirst: vi.fn(),
      },
      users: {
        findFirst: vi.fn(),
      },
    },
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    select: mockSelectExec,
    execute: vi.fn().mockResolvedValue([{ test: 1 }]),
  },
  policies: { id: {}, userId: {}, deletedAt: {}, isPublic: {}, groupId: {} },
  policyVersions: { policyId: {}, version: {} },
  policyGroups: { id: {}, userId: {} },
  executions: { policyId: {} },
  users: { id: {}, plan: {}, trialEndsAt: {} },
}));

import { GET, POST } from '@/app/api/policies/route';
import { GET as GET_ID, PUT, DELETE } from '@/app/api/policies/[id]/route';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { getPolicyFreezeStatus, isPolicyFrozen } from '@/lib/policy-freeze';
import { softDeletePolicy } from '@/lib/policy-lifecycle';
import { detectPII } from '@/services/pii/detector';
import type { PIIDetectionResult } from '@/services/pii/detector';

const mockGetSession = vi.mocked(getSession);
const mockGetPolicyFreezeStatus = vi.mocked(getPolicyFreezeStatus);
const mockIsPolicyFrozen = vi.mocked(isPolicyFrozen);
const mockSoftDeletePolicy = vi.mocked(softDeletePolicy);
const mockDetectPII = vi.mocked(detectPII);

const DEFAULT_SESSION = { user: { id: 'user-1' } } as Awaited<ReturnType<typeof getSession>>;

function makeRequest(
  url: string,
  method = 'GET',
  body?: Record<string, unknown>
): Request {
  return new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  });
}

// Setup a select chain that returns grouped execution counts
function setupGroupBySelect(rows: { policyId: string; count: number }[] = []) {
  const groupBy = vi.fn().mockResolvedValue(rows);
  const whereCount = vi.fn().mockReturnValue({ groupBy });
  const fromCount = vi.fn().mockReturnValue({ where: whereCount });
  mockSelectExec.mockReturnValue({ from: fromCount });
}

// Setup a select chain that returns a single count row
function setupCountSelect(count: number) {
  const whereCount = vi.fn().mockResolvedValue([{ count }]);
  const fromCount = vi.fn().mockReturnValue({ where: whereCount });
  mockSelectExec.mockReturnValue({ from: fromCount });
}

// 部分策略对象，仅包含测试需要的字段
function mockPolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    userId: 'user-1',
    name: 'Test Policy',
    content: 'Module X.',
    description: null,
    teamId: null,
    groupId: null,
    version: 1,
    isPublic: false,
    shareSlug: null,
    piiFields: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// 部分用户对象
function mockUser(overrides: Record<string, unknown> = {}) {
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
    plan: 'pro' as const,
    stripeCustomerId: null,
    subscriptionId: null,
    subscriptionStatus: null,
    trialStartedAt: null,
    trialEndsAt: null,
    onboardingUseCase: null,
    onboardingGoals: null,
    onboardingCompletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// 部分策略版本对象
function mockPolicyVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    policyId: 'p1',
    version: 1,
    content: 'Module X.',
    source: null,
    sourceHash: null,
    prevHash: null,
    comment: null,
    status: 'DRAFT' as const,
    createdBy: null,
    isDefault: false,
    releaseNote: null,
    deprecatedAt: null,
    deprecatedBy: null,
    archivedAt: null,
    archivedBy: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('Policies API - Drizzle Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(DEFAULT_SESSION);
    // Default freeze status: no freezes
    mockGetPolicyFreezeStatus.mockResolvedValue({
      limit: 25,
      totalPolicies: 1,
      frozenCount: 0,
      frozenPolicyIds: new Set(),
    });
    mockIsPolicyFrozen.mockResolvedValue({
      isFrozen: false,
      activePoliciesLimit: 25,
      totalPolicies: 1,
      frozenCount: 0,
    });
    // Default select: returns empty execution counts
    setupGroupBySelect([]);
  });

  describe('GET /api/policies', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return policies list with freeze info', async () => {
      const policies = [
        mockPolicy({ group: null }),
      ];
      vi.mocked(db.query.policies.findMany).mockResolvedValue(policies);
      setupGroupBySelect([{ policyId: 'p1', count: 5 }]);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.policies).toHaveLength(1);
      expect(body.policies[0].id).toBe('p1');
      expect(body.freezeInfo).toBeDefined();
      expect(body.freezeInfo.limit).toBe(25);
    });

    it('should mark frozen policies in list', async () => {
      const policies = [
        mockPolicy({ id: 'p1', name: 'Active Policy', group: null }),
        mockPolicy({ id: 'p2', name: 'Frozen Policy', group: null }),
      ];
      vi.mocked(db.query.policies.findMany).mockResolvedValue(policies);
      mockGetPolicyFreezeStatus.mockResolvedValue({
        limit: 1,
        totalPolicies: 2,
        frozenCount: 1,
        frozenPolicyIds: new Set(['p2']),
      });

      const response = await GET();
      const body = await response.json();

      const p1 = body.policies.find((p: { id: string }) => p.id === 'p1');
      const p2 = body.policies.find((p: { id: string }) => p.id === 'p2');
      expect(p1.isFrozen).toBe(false);
      expect(p2.isFrozen).toBe(true);
    });

    it('should return 500 on internal error', async () => {
      vi.mocked(db.query.policies.findMany).mockRejectedValue(new Error('DB failure'));

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('POST /api/policies', () => {
    const validBody = { name: 'My Policy', content: 'Module X.' };

    beforeEach(() => {
      // Setup user check (within policy limit)
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'pro' }));
      // Setup policy count select (current count = 1, limit = 25)
      setupCountSelect(1);
      // Setup successful insert
      const policy = mockPolicy({ id: 'new-p1', name: 'My Policy' });
      mockReturningInsert.mockResolvedValue([policy]);
      mockValuesInsert.mockReturnValue({ returning: mockReturningInsert });
      mockInsert.mockReturnValue({ values: mockValuesInsert });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await POST(makeRequest('http://localhost/api/policies', 'POST', validBody));
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 when name is missing', async () => {
      const response = await POST(
        makeRequest('http://localhost/api/policies', 'POST', { content: 'Module X.' })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('required');
    });

    it('should return 400 when content is missing', async () => {
      const response = await POST(
        makeRequest('http://localhost/api/policies', 'POST', { name: 'Test' })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('required');
    });

    it('should return 403 when policy limit is reached for free user', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser({ plan: 'free' }));
      // free plan limit = 3, current count = 3
      setupCountSelect(3);

      const response = await POST(makeRequest('http://localhost/api/policies', 'POST', validBody));
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Policy limit reached');
      expect(body.upgrade).toBe(true);
    });

    it('should return 404 when specified groupId does not belong to user', async () => {
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(undefined);

      const response = await POST(
        makeRequest('http://localhost/api/policies', 'POST', {
          ...validBody,
          groupId: 'group-nonexistent',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Group not found');
    });

    it('should detect PII and include in policy creation', async () => {
      mockDetectPII.mockReturnValue({
        hasPII: true,
        detectedTypes: ['email', 'phone'],
        locations: [],
        riskLevel: 'medium',
      } satisfies PIIDetectionResult);
      const policy = mockPolicy({ id: 'new-p1', name: 'PII Policy', piiFields: ['email', 'phone'] });
      mockReturningInsert.mockResolvedValue([policy]);

      const response = await POST(makeRequest('http://localhost/api/policies', 'POST', validBody));

      expect(mockDetectPII).toHaveBeenCalledWith('Module X.');
      expect(response.status).toBe(201);
    });

    it('should create policy with status 201', async () => {
      const response = await POST(makeRequest('http://localhost/api/policies', 'POST', validBody));

      expect(response.status).toBe(201);
    });
  });

  describe('GET /api/policies/[id]', () => {
    const mockParams = { params: Promise.resolve({ id: 'p1' }) };

    beforeEach(() => {
      vi.mocked(db.query.policyVersions.findMany).mockResolvedValue([]);
      setupCountSelect(3);
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await GET_ID(makeRequest('http://localhost/api/policies/p1'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when policy is not found', async () => {
      vi.mocked(db.query.policies.findFirst).mockResolvedValue(undefined);

      const response = await GET_ID(makeRequest('http://localhost/api/policies/p1'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Policy not found');
    });

    it('should return policy with versions and execution count', async () => {
      vi.mocked(db.query.policies.findFirst).mockResolvedValue(
        mockPolicy({ team: null })
      );
      vi.mocked(db.query.policyVersions.findMany).mockResolvedValue([
        mockPolicyVersion(),
      ]);

      const response = await GET_ID(makeRequest('http://localhost/api/policies/p1'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe('p1');
      expect(body.versions).toHaveLength(1);
      expect(body._count.executions).toBe(3);
    });

    it('should include freeze info for own policies', async () => {
      vi.mocked(db.query.policies.findFirst).mockResolvedValue(mockPolicy());
      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Plan limit exceeded',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await GET_ID(makeRequest('http://localhost/api/policies/p1'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.isFrozen).toBe(true);
      expect(body.freezeInfo.reason).toBe('Plan limit exceeded');
    });
  });

  describe('PUT /api/policies/[id]', () => {
    const mockParams = { params: Promise.resolve({ id: 'p1' }) };
    const updateBody = { name: 'Updated Policy', content: 'Module Updated.' };

    beforeEach(() => {
      const existingPolicy = mockPolicy();
      vi.mocked(db.query.policies.findFirst).mockResolvedValue(existingPolicy);
      mockReturningUpdate.mockResolvedValue([mockPolicy({ name: 'Updated Policy', version: 2 })]);
      mockWhereUpdate.mockReturnValue({ returning: mockReturningUpdate });
      mockSetUpdate.mockReturnValue({ where: mockWhereUpdate });
      mockUpdate.mockReturnValue({ set: mockSetUpdate });
      mockReturningInsert.mockResolvedValue([{ id: 'v2' }]);
      mockValuesInsert.mockReturnValue({ returning: mockReturningInsert });
      mockInsert.mockReturnValue({ values: mockValuesInsert });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await PUT(
        makeRequest('http://localhost/api/policies/p1', 'PUT', updateBody),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when policy is not found', async () => {
      vi.mocked(db.query.policies.findFirst).mockResolvedValue(undefined);

      const response = await PUT(
        makeRequest('http://localhost/api/policies/p1', 'PUT', updateBody),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Policy not found');
    });

    it('should return 403 when policy is frozen', async () => {
      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Plan allows 3 policies but you have 5.',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await PUT(
        makeRequest('http://localhost/api/policies/p1', 'PUT', updateBody),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.frozen).toBe(true);
      expect(body.error).toBe('Policy is frozen');
    });

    it('should return updated policy on success', async () => {
      const response = await PUT(
        makeRequest('http://localhost/api/policies/p1', 'PUT', updateBody),
        mockParams
      );

      expect(response.status).toBe(200);
    });

    it('should return 500 on database error', async () => {
      mockUpdate.mockImplementation(() => { throw new Error('DB error'); });

      const response = await PUT(
        makeRequest('http://localhost/api/policies/p1', 'PUT', updateBody),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('DELETE /api/policies/[id]', () => {
    const mockParams = { params: Promise.resolve({ id: 'p1' }) };

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await DELETE(makeRequest('http://localhost/api/policies/p1', 'DELETE'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when policy is not found', async () => {
      mockSoftDeletePolicy.mockResolvedValue({
        success: false,
        policyId: 'p1',
        error: 'Policy not found or already deleted',
      });

      const response = await DELETE(makeRequest('http://localhost/api/policies/p1', 'DELETE'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Policy not found or already deleted');
    });

    it('should return success message on soft delete', async () => {
      mockSoftDeletePolicy.mockResolvedValue({ success: true, policyId: 'p1' });

      const response = await DELETE(makeRequest('http://localhost/api/policies/p1', 'DELETE'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.message).toContain('trash');
    });

    it('should pass deletion reason to softDeletePolicy when provided', async () => {
      mockSoftDeletePolicy.mockResolvedValue({ success: true, policyId: 'p1' });

      await DELETE(
        makeRequest('http://localhost/api/policies/p1', 'DELETE', { reason: 'No longer needed' }),
        mockParams
      );

      expect(mockSoftDeletePolicy).toHaveBeenCalledWith('p1', 'user-1', 'No longer needed');
    });
  });
});

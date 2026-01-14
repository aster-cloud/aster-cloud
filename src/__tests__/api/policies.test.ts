import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/policies/route';
import {
  GET as GET_BY_ID,
  PUT,
  DELETE,
} from '@/app/api/policies/[id]/route';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, recordUsage } from '@/lib/usage';
import {
  getPolicyFreezeStatus,
  isPolicyFrozen,
} from '@/lib/policy-freeze';
import { detectPII } from '@/services/pii/detector';
import { softDeletePolicy } from '@/lib/policy-lifecycle';

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/policy-lifecycle', () => ({
  softDeletePolicy: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    policy: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    policyVersion: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    execution: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/usage', () => ({
  checkUsageLimit: vi.fn().mockResolvedValue({ allowed: true }),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/policy-freeze', () => ({
  getPolicyFreezeStatus: vi.fn(),
  isPolicyFrozen: vi.fn(),
}));

vi.mock('@/services/pii/detector', () => ({
  detectPII: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockCheckUsageLimit = vi.mocked(checkUsageLimit);
const mockRecordUsage = vi.mocked(recordUsage);
const mockGetPolicyFreezeStatus = vi.mocked(getPolicyFreezeStatus);
const mockIsPolicyFrozen = vi.mocked(isPolicyFrozen);
const mockDetectPII = vi.mocked(detectPII);
const mockSoftDeletePolicy = vi.mocked(softDeletePolicy);

// Type-safe mock for Prisma
type MockFn = ReturnType<typeof vi.fn>;
const mockPrisma = {
  policy: {
    findMany: prisma.policy.findMany as unknown as MockFn,
    findFirst: prisma.policy.findFirst as unknown as MockFn,
    create: prisma.policy.create as unknown as MockFn,
    update: prisma.policy.update as unknown as MockFn,
    delete: prisma.policy.delete as unknown as MockFn,
    count: prisma.policy.count as unknown as MockFn,
  },
  policyVersion: {
    create: prisma.policyVersion.create as unknown as MockFn,
  },
  user: {
    findUnique: prisma.user.findUnique as unknown as MockFn,
  },
  execution: {
    create: prisma.execution.create as unknown as MockFn,
  },
};

// 辅助函数：创建 POST 请求
function createPostRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/policies', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// 辅助函数：创建带 ID 的请求
function createRequestWithId(
  id: string,
  method: string,
  body?: Record<string, unknown>
) {
  const options: RequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  return new Request(`http://localhost/api/policies/${id}`, options);
}

// 辅助函数：创建 Next.js 15 的 async params
function createParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('Policies API - 真实路由测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
    } as Awaited<ReturnType<typeof getSession>>);
    mockDetectPII.mockReturnValue({
      hasPII: false,
      detectedTypes: [],
      locations: [],
      riskLevel: 'low',
    });
  });

  describe('GET /api/policies', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return policies list with freeze status', async () => {
      const mockPolicies = [
        {
          id: 'p1',
          name: 'Policy 1',
          description: 'Test',
          content: 'if score >= 80 then approve',
          isPublic: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { executions: 5 },
        },
        {
          id: 'p2',
          name: 'Policy 2',
          description: 'Test 2',
          content: 'if age >= 18 then allow',
          isPublic: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { executions: 10 },
        },
      ];

      mockPrisma.policy.findMany.mockResolvedValue(mockPolicies);
      // 路由使用 getPolicyFreezeStatus，返回 frozenPolicyIds Set
      mockGetPolicyFreezeStatus.mockResolvedValue({
        frozenPolicyIds: new Set<string>(),
        limit: 10,
        totalPolicies: 2,
        frozenCount: 0,
      });

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.policies).toHaveLength(2);
      expect(body.policies[0].name).toBe('Policy 1');
      expect(body.freezeInfo.limit).toBe(10);
      expect(mockPrisma.policy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', deletedAt: null },
        })
      );
    });

    it('should return 500 on internal error', async () => {
      mockPrisma.policy.findMany.mockRejectedValue(new Error('Database error'));

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('POST /api/policies', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        plan: 'pro',
      });
      mockPrisma.policy.count.mockResolvedValue(0);
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await POST(
        createPostRequest({
          name: 'Test Policy',
          content: 'if score >= 80 then approve',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 when name is missing', async () => {
      const response = await POST(
        createPostRequest({
          content: 'if score >= 80 then approve',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('required');
    });

    it('should return 400 when content is missing', async () => {
      const response = await POST(
        createPostRequest({
          name: 'Test Policy',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('required');
    });

    it('should return 403 when free user exceeds policy limit', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        plan: 'free',
      });
      mockPrisma.policy.count.mockResolvedValue(3); // At limit

      const response = await POST(
        createPostRequest({
          name: 'Test Policy',
          content: 'if score >= 80 then approve',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toContain('limit');
    });

    it('should create policy and version on success', async () => {
      const newPolicy = {
        id: 'new-policy',
        name: 'Test Policy',
        content: 'if score >= 80 then approve',
        description: null,
        isPublic: false,
        piiFields: [],
        version: 1,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.policy.create.mockResolvedValue(newPolicy);
      mockPrisma.policyVersion.create.mockResolvedValue({});

      const response = await POST(
        createPostRequest({
          name: 'Test Policy',
          content: 'if score >= 80 then approve',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.id).toBe('new-policy');
      expect(body.name).toBe('Test Policy');
      expect(mockPrisma.policy.create).toHaveBeenCalled();
      expect(mockPrisma.policyVersion.create).toHaveBeenCalled();
    });

    it('should detect and store PII fields', async () => {
      mockDetectPII.mockReturnValue({
        hasPII: true,
        detectedTypes: ['email', 'phone'],
        locations: [
          { type: 'pattern', match: 'user@test.com', index: 10 },
        ],
        riskLevel: 'medium',
      });

      mockPrisma.policy.create.mockResolvedValue({
        id: 'new-policy',
        name: 'PII Policy',
        content: 'if email then notify',
        piiFields: ['email', 'phone'],
      });
      mockPrisma.policyVersion.create.mockResolvedValue({});

      const response = await POST(
        createPostRequest({
          name: 'PII Policy',
          content: 'if email then notify',
        })
      );

      expect(response.status).toBe(201);
      expect(mockDetectPII).toHaveBeenCalled();
      expect(mockPrisma.policy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            piiFields: ['email', 'phone'],
          }),
        })
      );
    });

    it('should return 500 on internal error', async () => {
      mockPrisma.policy.create.mockRejectedValue(new Error('Database error'));

      const response = await POST(
        createPostRequest({
          name: 'Test Policy',
          content: 'if score >= 80 then approve',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('GET /api/policies/[id]', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await GET_BY_ID(
        createRequestWithId('policy-1', 'GET'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when policy not found', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue(null);

      const response = await GET_BY_ID(
        createRequestWithId('non-existent', 'GET'),
        createParams('non-existent')
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Policy not found');
    });

    it('should return policy with freeze info', async () => {
      const mockPolicy = {
        id: 'policy-1',
        name: 'Test Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1',
        versions: [],
        _count: { executions: 5 },
      };

      mockPrisma.policy.findFirst.mockResolvedValue(mockPolicy);
      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: false,
        activePoliciesLimit: 10,
        totalPolicies: 5,
        frozenCount: 0,
      });

      const response = await GET_BY_ID(
        createRequestWithId('policy-1', 'GET'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe('policy-1');
      // isFrozen 在顶层，freezeInfo 包含详细信息
      expect(body.isFrozen).toBe(false);
      expect(body.freezeInfo).toBeDefined();
      expect(body.freezeInfo.limit).toBe(10);
    });
  });

  describe('PUT /api/policies/[id]', () => {
    beforeEach(() => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Original Name',
        content: 'original content',
        userId: 'user-1',
        version: 1,
      });
      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: false,
        activePoliciesLimit: 10,
        totalPolicies: 5,
        frozenCount: 0,
      });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await PUT(
        createRequestWithId('policy-1', 'PUT', { name: 'Updated' }),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when policy not found', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue(null);

      const response = await PUT(
        createRequestWithId('non-existent', 'PUT', { name: 'Updated' }),
        createParams('non-existent')
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Policy not found');
    });

    it('should return 403 when policy is frozen', async () => {
      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Policy is frozen due to plan limit',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await PUT(
        createRequestWithId('policy-1', 'PUT', { name: 'Updated' }),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Policy is frozen');
      expect(body.frozen).toBe(true);
      expect(mockPrisma.policy.update).not.toHaveBeenCalled();
    });

    it('should update policy and create version when content changes', async () => {
      mockPrisma.policy.update.mockResolvedValue({
        id: 'policy-1',
        name: 'Updated Name',
        content: 'new content',
        version: 2,
      });
      mockPrisma.policyVersion.create.mockResolvedValue({});

      const response = await PUT(
        createRequestWithId('policy-1', 'PUT', {
          name: 'Updated Name',
          content: 'new content',
        }),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.name).toBe('Updated Name');
      expect(mockPrisma.policy.update).toHaveBeenCalled();
      expect(mockPrisma.policyVersion.create).toHaveBeenCalled();
    });

    it('should update policy without version when only name changes', async () => {
      mockPrisma.policy.update.mockResolvedValue({
        id: 'policy-1',
        name: 'Updated Name',
        content: 'original content',
        version: 1,
      });

      const response = await PUT(
        createRequestWithId('policy-1', 'PUT', {
          name: 'Updated Name',
          content: 'original content', // Same as existing, no version should be created
        }),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.name).toBe('Updated Name');
      expect(mockPrisma.policyVersion.create).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/policies/[id]', () => {
    beforeEach(() => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        userId: 'user-1',
      });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await DELETE(
        createRequestWithId('policy-1', 'DELETE'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when policy not found or not owned', async () => {
      mockSoftDeletePolicy.mockResolvedValue({ success: false, policyId: 'non-existent', error: 'Policy not found' });

      const response = await DELETE(
        createRequestWithId('non-existent', 'DELETE'),
        createParams('non-existent')
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Policy not found');
    });

    it('should delete policy even if frozen (to reduce count)', async () => {
      mockSoftDeletePolicy.mockResolvedValue({ success: true, policyId: 'policy-1' });

      const response = await DELETE(
        createRequestWithId('policy-1', 'DELETE'),
        createParams('policy-1')
      );
      const body = await response.json();

      // 路由返回 200 和 { success: true }
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockSoftDeletePolicy).toHaveBeenCalledWith('policy-1', 'user-1', undefined);
    });

    it('should return 500 on internal error', async () => {
      mockSoftDeletePolicy.mockRejectedValue(new Error('Database error'));

      const response = await DELETE(
        createRequestWithId('policy-1', 'DELETE'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });
});

describe('Policy Freeze Behavior - 真实路由测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
    } as Awaited<ReturnType<typeof getSession>>);
  });

  describe('GET /api/policies with freeze status', () => {
    it('should return policies with correct freeze indicators', async () => {
      const mockPolicies = [
        { id: 'p1', name: 'Active 1', updatedAt: new Date('2024-01-05'), _count: { executions: 0 } },
        { id: 'p2', name: 'Active 2', updatedAt: new Date('2024-01-04'), _count: { executions: 0 } },
        { id: 'p3', name: 'Active 3', updatedAt: new Date('2024-01-03'), _count: { executions: 0 } },
        { id: 'p4', name: 'Frozen 1', updatedAt: new Date('2024-01-02'), _count: { executions: 0 } },
        { id: 'p5', name: 'Frozen 2', updatedAt: new Date('2024-01-01'), _count: { executions: 0 } },
      ];

      mockPrisma.policy.findMany.mockResolvedValue(mockPolicies);
      // 路由使用 getPolicyFreezeStatus，返回 frozenPolicyIds 为 Set
      mockGetPolicyFreezeStatus.mockResolvedValue({
        frozenPolicyIds: new Set(['p4', 'p5']),
        limit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.policies).toHaveLength(5);
      expect(body.policies[0].isFrozen).toBe(false);
      expect(body.policies[3].isFrozen).toBe(true);
      expect(body.policies[4].isFrozen).toBe(true);
      expect(body.freezeInfo.frozenCount).toBe(2);
    });

    it('should return no frozen policies for unlimited plan', async () => {
      const mockPolicies = [
        { id: 'p1', name: 'Policy 1', _count: { executions: 0 } },
        { id: 'p2', name: 'Policy 2', _count: { executions: 0 } },
      ];

      mockPrisma.policy.findMany.mockResolvedValue(mockPolicies);
      mockGetPolicyFreezeStatus.mockResolvedValue({
        frozenPolicyIds: new Set<string>(),
        limit: -1, // unlimited
        totalPolicies: 2,
        frozenCount: 0,
      });

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.policies.every((p: { isFrozen: boolean }) => !p.isFrozen)).toBe(true);
    });
  });

  describe('GET /api/policies/[id] freeze info', () => {
    it('should return freeze info for frozen policy', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        name: 'Frozen Policy',
        userId: 'user-1',
        versions: [],
        _count: { executions: 0 },
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Policy is frozen because it exceeds your plan limit',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await GET_BY_ID(
        createRequestWithId('policy-4', 'GET'),
        createParams('policy-4')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      // isFrozen 在顶层
      expect(body.isFrozen).toBe(true);
      // freezeInfo 包含详细信息（limit, total, frozenCount）
      expect(body.freezeInfo.limit).toBe(3);
      expect(body.freezeInfo.total).toBe(5);
    });

    it('should return not frozen for active policy', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Active Policy',
        userId: 'user-1',
        versions: [],
        _count: { executions: 5 },
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: false,
        activePoliciesLimit: 10,
        totalPolicies: 3,
        frozenCount: 0,
      });

      const response = await GET_BY_ID(
        createRequestWithId('policy-1', 'GET'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      // isFrozen 在顶层
      expect(body.isFrozen).toBe(false);
    });
  });

  describe('PUT /api/policies/[id] freeze blocking', () => {
    it('should block update with 403 when policy is frozen', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        name: 'Frozen Policy',
        content: 'old content',
        userId: 'user-1',
        version: 1,
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Policy is frozen',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await PUT(
        createRequestWithId('policy-4', 'PUT', { content: 'new content' }),
        createParams('policy-4')
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.frozen).toBe(true);
      expect(body.message).toContain('frozen');
      expect(mockPrisma.policy.update).not.toHaveBeenCalled();
    });

    it('should allow update when policy is not frozen', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Active Policy',
        content: 'old content',
        userId: 'user-1',
        version: 1,
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: false,
        activePoliciesLimit: 10,
        totalPolicies: 3,
        frozenCount: 0,
      });

      mockPrisma.policy.update.mockResolvedValue({
        id: 'policy-1',
        content: 'new content',
        version: 2,
      });
      mockPrisma.policyVersion.create.mockResolvedValue({});
      mockDetectPII.mockReturnValue({
        hasPII: false,
        detectedTypes: [],
        locations: [],
        riskLevel: 'low',
      });

      const response = await PUT(
        createRequestWithId('policy-1', 'PUT', { content: 'new content' }),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.content).toBe('new content');
      expect(mockPrisma.policy.update).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/policies/[id] on frozen policy', () => {
    it('should allow deletion of frozen policy to reduce count', async () => {
      mockSoftDeletePolicy.mockResolvedValue({ success: true, policyId: 'policy-4' });

      const response = await DELETE(
        createRequestWithId('policy-4', 'DELETE'),
        createParams('policy-4')
      );
      const body = await response.json();

      // 路由返回 200 和 { success: true }
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockSoftDeletePolicy).toHaveBeenCalledWith('policy-4', 'user-1', undefined);
    });
  });
});

describe('Policy Edge Cases - 真实路由测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: { id: 'trial-user', email: 'trial@example.com' },
    } as Awaited<ReturnType<typeof getSession>>);
  });

  it('should handle trial expiration affecting freeze status', async () => {
    // 用户原来是 trial（25 policies limit），但 trial 过期后降级为 free（3 policies limit）
    // 现在有 10 个 policies，7 个被冻结
    const mockPolicies = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Policy ${i + 1}`,
      updatedAt: new Date(`2024-01-${String(10 - i).padStart(2, '0')}`),
      _count: { executions: 0 },
    }));

    mockPrisma.policy.findMany.mockResolvedValue(mockPolicies);

    // 前 3 个 ID 不在冻结集合中（活跃），后 7 个在冻结集合中
    const frozenIds = mockPolicies.slice(3).map((p) => p.id);
    mockGetPolicyFreezeStatus.mockResolvedValue({
      frozenPolicyIds: new Set(frozenIds),
      limit: 3,
      totalPolicies: 10,
      frozenCount: 7,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policies).toHaveLength(10);

    const frozenPolicies = body.policies.filter(
      (p: { isFrozen: boolean }) => p.isFrozen
    );
    expect(frozenPolicies).toHaveLength(7);
    expect(body.freezeInfo.frozenCount).toBe(7);
  });

  it('should correctly order policies by updatedAt for freeze determination', async () => {
    const mockPolicies = [
      { id: 'recently-updated', name: 'Recent', updatedAt: new Date('2024-12-01'), _count: { executions: 5 } },
      { id: 'old-policy', name: 'Old', updatedAt: new Date('2024-01-01'), _count: { executions: 10 } },
    ];

    mockPrisma.policy.findMany.mockResolvedValue(mockPolicies);
    // 只有老策略被冻结
    mockGetPolicyFreezeStatus.mockResolvedValue({
      frozenPolicyIds: new Set(['old-policy']),
      limit: 1,
      totalPolicies: 2,
      frozenCount: 1,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    const recentPolicy = body.policies.find(
      (p: { id: string }) => p.id === 'recently-updated'
    );
    const oldPolicy = body.policies.find((p: { id: string }) => p.id === 'old-policy');

    expect(recentPolicy.isFrozen).toBe(false);
    expect(oldPolicy.isFrozen).toBe(true);
  });
});

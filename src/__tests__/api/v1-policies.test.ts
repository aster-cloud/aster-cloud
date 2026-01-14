import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/v1/policies/route';
import { POST as EXECUTE } from '@/app/api/v1/policies/[id]/execute/route';
import { authenticateApiRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { checkUsageLimit, recordUsage } from '@/lib/usage';
import {
  getPolicyFreezeStatus,
  getBatchPolicyFreezeStatus,
  isPolicyFrozen,
} from '@/lib/policy-freeze';
import { checkTeamPermission } from '@/lib/team-permissions';
import { executePolicyUnified, getPrimaryError } from '@/services/policy/cnl-executor';

vi.mock('@/lib/api-keys', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    policy: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    execution: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/usage', () => ({
  checkUsageLimit: vi.fn(),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/policy-freeze', () => ({
  getPolicyFreezeStatus: vi.fn(),
  getBatchPolicyFreezeStatus: vi.fn(),
  isPolicyFrozen: vi.fn(),
}));

vi.mock('@/lib/team-permissions', () => ({
  checkTeamPermission: vi.fn(),
  TeamPermission: {
    POLICY_EXECUTE: 'execute',
  },
}));

vi.mock('@/services/policy/cnl-executor', () => ({
  executePolicyUnified: vi.fn(),
  getPrimaryError: vi.fn(),
}));

const mockAuthenticateApiRequest = vi.mocked(authenticateApiRequest);
const mockCheckUsageLimit = vi.mocked(checkUsageLimit);
const mockRecordUsage = vi.mocked(recordUsage);
const mockGetPolicyFreezeStatus = vi.mocked(getPolicyFreezeStatus);
const mockGetBatchPolicyFreezeStatus = vi.mocked(getBatchPolicyFreezeStatus);
const mockIsPolicyFrozen = vi.mocked(isPolicyFrozen);
const mockCheckTeamPermission = vi.mocked(checkTeamPermission);
// Type-safe mock for Prisma and functions
type MockFn = ReturnType<typeof vi.fn>;
const mockExecutePolicyUnified = executePolicyUnified as unknown as MockFn;
const mockGetPrimaryError = getPrimaryError as unknown as MockFn;
const mockPrisma = {
  policy: {
    findMany: prisma.policy.findMany as unknown as MockFn,
    findFirst: prisma.policy.findFirst as unknown as MockFn,
  },
  execution: {
    create: prisma.execution.create as unknown as MockFn,
  },
};

// 辅助函数：创建带 API Key 的 GET 请求
function createGetRequest(apiKey?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }
  return new Request('http://localhost/api/v1/policies', {
    method: 'GET',
    headers,
  });
}

// 辅助函数：创建执行请求
function createExecuteRequest(
  id: string,
  body: Record<string, unknown>,
  apiKey?: string
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }
  return new Request(`http://localhost/api/v1/policies/${id}/execute`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

// 辅助函数：创建 Next.js 15 的 async params
function createParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// 辅助函数：创建执行结果的默认 metadata
function createExecutionResultMetadata(policyId = 'policy-1', policyName = 'Test Policy') {
  return {
    evaluatedAt: new Date().toISOString(),
    policyId,
    policyName,
    ruleCount: 1,
    matchedRuleCount: 1,
  };
}

describe('V1 Policies API - 真实路由测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/policies', () => {
    it('should return 401 when API key is missing', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: false,
        error: 'API key is required',
        status: 401,
      });

      const response = await GET(createGetRequest());
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('API key is required');
    });

    it('should return 401 when API key is invalid', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: false,
        error: 'Invalid API key',
        status: 401,
      });

      const response = await GET(createGetRequest('invalid-key'));
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Invalid API key');
    });

    it('should return 429 when API call limit exceeded', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({
        allowed: false,
        message: 'API call limit exceeded for this month',
        remaining: 0,
        limit: 1000,
      });

      const response = await GET(createGetRequest('valid-key'));
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body.error).toContain('limit');
    });

    it('should return own policies with freeze status', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({ allowed: true, remaining: 999 });

      const mockPolicies = [
        {
          id: 'p1',
          name: 'Policy 1',
          description: 'Test policy',
          isPublic: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
          userId: 'user-1',
          _count: { executions: 5 },
        },
        {
          id: 'p2',
          name: 'Policy 2',
          description: null,
          isPublic: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          userId: 'user-1',
          _count: { executions: 10 },
        },
      ];

      // 第一次调用返回 own policies，第二次返回空的 team policies
      mockPrisma.policy.findMany
        .mockResolvedValueOnce(mockPolicies)
        .mockResolvedValueOnce([]);

      mockGetPolicyFreezeStatus.mockResolvedValue({
        limit: 10,
        totalPolicies: 2,
        frozenCount: 0,
        frozenPolicyIds: new Set<string>(),
      });

      // 没有团队策略所以不需要批量查询
      mockGetBatchPolicyFreezeStatus.mockResolvedValue(new Map());

      const response = await GET(createGetRequest('valid-key'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.policies).toHaveLength(2);
      expect(body.policies[0].name).toBe('Policy 1');
      expect(body.policies[0].isFrozen).toBe(false);
      expect(mockRecordUsage).toHaveBeenCalledWith('user-1', 'api_call');
    });

    it('should mark frozen policies correctly', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({ allowed: true, remaining: 999 });

      const mockPolicies = [
        {
          id: 'p1',
          name: 'Active',
          description: null,
          isPublic: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
          userId: 'user-1',
          _count: { executions: 5 },
        },
        {
          id: 'p2',
          name: 'Frozen',
          description: null,
          isPublic: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          userId: 'user-1',
          _count: { executions: 0 },
        },
      ];

      // 第一次返回 own policies，第二次返回空的 team policies
      mockPrisma.policy.findMany
        .mockResolvedValueOnce(mockPolicies)
        .mockResolvedValueOnce([]);

      mockGetPolicyFreezeStatus.mockResolvedValue({
        limit: 1,
        totalPolicies: 2,
        frozenCount: 1,
        frozenPolicyIds: new Set(['p2']),
      });

      mockGetBatchPolicyFreezeStatus.mockResolvedValue(new Map());

      const response = await GET(createGetRequest('valid-key'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.policies[0].isFrozen).toBe(false);
      expect(body.policies[1].isFrozen).toBe(true);
    });

    it('should include team policies with batch freeze status', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      } as Awaited<ReturnType<typeof authenticateApiRequest>>);

      mockCheckUsageLimit.mockResolvedValue({ allowed: true, remaining: 999 });

      // Own policies
      const ownPolicies = [
        {
          id: 'own-1',
          name: 'My Policy',
          description: null,
          isPublic: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
          userId: 'user-1',
          _count: { executions: 5 },
        },
      ];

      // Team policies from other members
      const teamPolicies = [
        {
          id: 'team-p1',
          name: 'Team Policy',
          description: 'Shared policy',
          isPublic: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          userId: 'user-2',
          teamId: 'team-1',
          team: { id: 'team-1', name: 'Test Team' },
          _count: { executions: 10 },
        },
      ];

      mockPrisma.policy.findMany
        .mockResolvedValueOnce(ownPolicies)
        .mockResolvedValueOnce(teamPolicies);

      mockGetPolicyFreezeStatus.mockResolvedValue({
        limit: 10,
        totalPolicies: 1,
        frozenCount: 0,
        frozenPolicyIds: new Set<string>(),
      });

      // getBatchPolicyFreezeStatus 返回 Map<userId, Set<frozenPolicyIds>>
      mockGetBatchPolicyFreezeStatus.mockResolvedValue(
        new Map([['user-2', new Set<string>()]])
      );

      const response = await GET(createGetRequest('valid-key'));
      const body = await response.json();

      expect(response.status).toBe(200);
      // 应该包含 own + team policies
      expect(body.policies).toHaveLength(2);
      expect(body.meta.ownCount).toBe(1);
      expect(body.meta.teamCount).toBe(1);
      expect(mockGetBatchPolicyFreezeStatus).toHaveBeenCalledWith(['user-2']);
    });

    it('should return 500 on internal error', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({ allowed: true, remaining: 999 });
      mockPrisma.policy.findMany.mockRejectedValue(new Error('Database error'));

      const response = await GET(createGetRequest('valid-key'));
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('POST /api/v1/policies/:id/execute', () => {
    beforeEach(() => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });
      mockCheckUsageLimit.mockResolvedValue({ allowed: true, remaining: 999 });
    });

    it('should return 401 when API key is missing', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: false,
        error: 'API key is required',
        status: 401,
      });

      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: { score: 90 } }),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('API key is required');
    });

    it('should return 400 for invalid JSON body', async () => {
      const request = new Request(
        'http://localhost/api/v1/policies/policy-1/execute',
        {
          method: 'POST',
          body: 'invalid-json',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer valid-key',
          },
        }
      );

      const response = await EXECUTE(request, createParams('policy-1'));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid');
    });

    it('should return 400 when input is not an object', async () => {
      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: 'not-an-object' }, 'valid-key'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('object');
    });

    it('should return 429 when API call limit exceeded', async () => {
      mockCheckUsageLimit.mockResolvedValueOnce({
        allowed: false,
        message: 'API call limit exceeded',
        remaining: 0,
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Test',
        userId: 'user-1',
      });

      mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: { score: 90 } }, 'valid-key'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body.error).toContain('limit');
    });

    it('should return 429 when execution limit exceeded', async () => {
      // API call check passes
      mockCheckUsageLimit.mockResolvedValueOnce({ allowed: true, remaining: 999 });
      // Execution check fails
      mockCheckUsageLimit.mockResolvedValueOnce({
        allowed: false,
        message: 'Execution limit exceeded',
        remaining: 0,
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Test',
        userId: 'user-1',
      });

      mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: { score: 90 } }, 'valid-key'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(429);
      expect(body.error).toContain('limit');
    });

    it('should return 404 for non-existent policy', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue(null);

      const response = await EXECUTE(
        createExecuteRequest('non-existent', { input: { score: 90 } }, 'valid-key'),
        createParams('non-existent')
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Policy not found');
    });

    it('should return 403 when policy is frozen', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Frozen Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1',
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Policy is frozen due to plan limit',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: { score: 90 } }, 'valid-key'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Policy is frozen');
      expect(body.frozen).toBe(true);
      expect(mockExecutePolicyUnified).not.toHaveBeenCalled();
    });

    it('should execute policy and record usage on success', async () => {
      const mockPolicy = {
        id: 'policy-1',
        name: 'Test Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1',
        rules: null,
      };

      mockPrisma.policy.findFirst.mockResolvedValue(mockPolicy);
      mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

      const executionResult = {
        allowed: true,
        approved: true,
        deniedReasons: [],
        matchedRules: ['score >= 80'],
        metadata: createExecutionResultMetadata(),
      };
      mockExecutePolicyUnified.mockResolvedValue(executionResult);
      mockGetPrimaryError.mockReturnValue(undefined);

      mockPrisma.execution.create.mockResolvedValue({
        id: 'exec-1',
        success: true,
      });

      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: { score: 90 } }, 'valid-key'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.allowed).toBe(true);
      expect(body.data.approved).toBe(true);
      expect(mockExecutePolicyUnified).toHaveBeenCalledWith(
        expect.objectContaining({
          policy: mockPolicy,
          input: { score: 90 },
        })
      );
      expect(mockRecordUsage).toHaveBeenCalledWith('user-1', 'api_call');
      expect(mockRecordUsage).toHaveBeenCalledWith('user-1', 'execution');
      expect(mockPrisma.execution.create).toHaveBeenCalled();
    });

    it('should allow access to public policies from other users', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-2', // Different user
        apiKeyId: 'key-2',
      });

      const mockPolicy = {
        id: 'policy-1',
        name: 'Public Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1', // Owner is different
        isPublic: true,
        rules: null,
      };

      mockPrisma.policy.findFirst.mockResolvedValue(mockPolicy);
      // Freeze check should use owner's ID
      mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

      const executionResult = {
        allowed: true,
        approved: true,
        deniedReasons: [],
        matchedRules: [],
        metadata: createExecutionResultMetadata(),
      };
      mockExecutePolicyUnified.mockResolvedValue(executionResult);
      mockGetPrimaryError.mockReturnValue(undefined);

      mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1', success: true });

      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: { score: 90 } }, 'valid-key'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      // Freeze check should be called with owner's userId
      expect(mockIsPolicyFrozen).toHaveBeenCalledWith('user-1', 'policy-1');
    });

    it('should create execution record with correct data', async () => {
      const mockPolicy = {
        id: 'policy-1',
        name: 'Test Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1',
        rules: null,
      };

      mockPrisma.policy.findFirst.mockResolvedValue(mockPolicy);
      mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

      const executionResult = {
        allowed: false,
        approved: false,
        deniedReasons: ['Score too low'],
        matchedRules: [],
        metadata: createExecutionResultMetadata(),
      };
      mockExecutePolicyUnified.mockResolvedValue(executionResult);
      mockGetPrimaryError.mockReturnValue('Score too low');

      mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1', success: false });

      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: { score: 50 } }, 'valid-key'),
        createParams('policy-1')
      );

      expect(response.status).toBe(200);
      expect(mockPrisma.execution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            policyId: 'policy-1',
            source: 'api',
            apiKeyId: 'key-1',
            success: false,
          }),
        })
      );
    });

    it('should handle executor errors gracefully', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Test Policy',
        content: 'invalid policy content',
        userId: 'user-1',
        rules: null,
      });

      mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });
      mockExecutePolicyUnified.mockRejectedValue(new Error('Parse error'));

      const response = await EXECUTE(
        createExecuteRequest('policy-1', { input: { score: 90 } }, 'valid-key'),
        createParams('policy-1')
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });
});

describe('V1 API Freeze Scenarios - 真实路由测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      success: true,
      userId: 'user-1',
      apiKeyId: 'key-1',
    });
    mockCheckUsageLimit.mockResolvedValue({ allowed: true, remaining: 999 });
  });

  describe('Frozen policy execution blocking', () => {
    it('should block execution when owner executes their frozen policy', async () => {
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        name: 'Frozen Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1',
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Policy is frozen',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await EXECUTE(
        createExecuteRequest('policy-4', { input: { score: 90 } }, 'valid-key'),
        createParams('policy-4')
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.frozen).toBe(true);
      expect(body.message).toContain('frozen');
      expect(mockExecutePolicyUnified).not.toHaveBeenCalled();
      expect(mockPrisma.execution.create).not.toHaveBeenCalled();
    });

    it('should block other users from executing frozen public policy', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-2', // Different user
        apiKeyId: 'key-2',
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        name: 'Public Frozen Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1', // Owner
        isPublic: true,
      });

      // Frozen for owner means frozen for everyone
      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Policy is frozen',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const response = await EXECUTE(
        createExecuteRequest('policy-4', { input: { score: 90 } }, 'valid-key'),
        createParams('policy-4')
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.frozen).toBe(true);
    });
  });

  describe('Team policy freeze handling', () => {
    it('should check freeze status for team member policies', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      } as Awaited<ReturnType<typeof authenticateApiRequest>>);

      // Policy owned by team member
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'team-policy',
        name: 'Team Member Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-2', // Different team member
        teamId: 'team-1',
        rules: null,
      });

      // Check freeze for policy owner
      mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });
      // Mock team permission check
      mockCheckTeamPermission.mockResolvedValue({ allowed: true });

      const executionResult = {
        allowed: true,
        approved: true,
        deniedReasons: [],
        matchedRules: [],
        metadata: createExecutionResultMetadata(),
      };
      mockExecutePolicyUnified.mockResolvedValue(executionResult);
      mockGetPrimaryError.mockReturnValue(undefined);

      mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1', success: true });

      const response = await EXECUTE(
        createExecuteRequest('team-policy', { input: { score: 90 } }, 'valid-key'),
        createParams('team-policy')
      );

      expect(response.status).toBe(200);
      // Freeze check should use policy owner's ID, not requester's
      expect(mockIsPolicyFrozen).toHaveBeenCalledWith('user-2', 'team-policy');
    });
  });
});

describe('V1 API Edge Cases - 真实路由测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      success: true,
      userId: 'user-1',
      apiKeyId: 'key-1',
    });
    mockCheckUsageLimit.mockResolvedValue({ allowed: true, remaining: 999 });
  });

  it('should handle empty input object', async () => {
    mockPrisma.policy.findFirst.mockResolvedValue({
      id: 'policy-1',
      name: 'Test Policy',
      content: 'if true then approve',
      userId: 'user-1',
      rules: null,
    });

    mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

    const executionResult = {
      allowed: true,
      approved: true,
      deniedReasons: [],
      matchedRules: ['true'],
      metadata: createExecutionResultMetadata(),
    };
    mockExecutePolicyUnified.mockResolvedValue(executionResult);
    mockGetPrimaryError.mockReturnValue(undefined);

    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1', success: true });

    const response = await EXECUTE(
      createExecuteRequest('policy-1', { input: {} }, 'valid-key'),
      createParams('policy-1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('should handle complex nested input', async () => {
    mockPrisma.policy.findFirst.mockResolvedValue({
      id: 'policy-1',
      name: 'Complex Policy',
      content: 'if user.profile.age >= 18 then allow',
      userId: 'user-1',
      rules: null,
    });

    mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

    const executionResult = {
      allowed: true,
      approved: true,
      deniedReasons: [],
      matchedRules: ['user.profile.age >= 18'],
      metadata: createExecutionResultMetadata(),
    };
    mockExecutePolicyUnified.mockResolvedValue(executionResult);
    mockGetPrimaryError.mockReturnValue(undefined);

    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1', success: true });

    const complexInput = {
      user: {
        profile: {
          age: 25,
          name: 'Test User',
        },
        roles: ['admin', 'user'],
      },
    };

    const response = await EXECUTE(
      createExecuteRequest('policy-1', { input: complexInput }, 'valid-key'),
      createParams('policy-1')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockExecutePolicyUnified).toHaveBeenCalledWith(
      expect.objectContaining({
        input: complexInput,
      })
    );
  });

  it('should use parsed rules when available', async () => {
    const parsedRules = [
      { field: 'score', operator: '>=', value: 80, action: 'approve' },
    ];

    mockPrisma.policy.findFirst.mockResolvedValue({
      id: 'policy-1',
      name: 'Pre-parsed Policy',
      content: 'if score >= 80 then approve',
      userId: 'user-1',
      rules: parsedRules,
    });

    mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

    const executionResult = {
      allowed: true,
      approved: true,
      deniedReasons: [],
      matchedRules: [],
      metadata: createExecutionResultMetadata(),
    };
    mockExecutePolicyUnified.mockResolvedValue(executionResult);
    mockGetPrimaryError.mockReturnValue(undefined);

    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1', success: true });

    const response = await EXECUTE(
      createExecuteRequest('policy-1', { input: { score: 90 } }, 'valid-key'),
      createParams('policy-1')
    );

    expect(response.status).toBe(200);
    expect(mockExecutePolicyUnified).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({
          rules: parsedRules,
        }),
      })
    );
  });

  it('should record execution duration', async () => {
    mockPrisma.policy.findFirst.mockResolvedValue({
      id: 'policy-1',
      name: 'Test Policy',
      content: 'if score >= 80 then approve',
      userId: 'user-1',
      rules: null,
    });

    mockIsPolicyFrozen.mockResolvedValue({ isFrozen: false, activePoliciesLimit: 10, totalPolicies: 1, frozenCount: 0 });

    const executionResult = {
      allowed: true,
      approved: true,
      deniedReasons: [],
      matchedRules: [],
      metadata: createExecutionResultMetadata(),
    };
    mockExecutePolicyUnified.mockResolvedValue(executionResult);
    mockGetPrimaryError.mockReturnValue(undefined);

    mockPrisma.execution.create.mockResolvedValue({ id: 'exec-1', success: true });

    await EXECUTE(
      createExecuteRequest('policy-1', { input: { score: 90 } }, 'valid-key'),
      createParams('policy-1')
    );

    expect(mockPrisma.execution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          durationMs: expect.any(Number),
        }),
      })
    );
  });
});

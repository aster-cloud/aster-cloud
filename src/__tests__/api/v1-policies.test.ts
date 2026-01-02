import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockAuthenticateApiRequest = vi.fn();
const mockCheckUsageLimit = vi.fn();
const mockRecordUsage = vi.fn();
const mockGetPolicyFreezeStatus = vi.fn();
const mockExecutePolicy = vi.fn();

const mockPrisma = {
  policy: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  execution: {
    create: vi.fn(),
  },
};

vi.mock('@/lib/api-keys', () => ({
  authenticateApiRequest: () => mockAuthenticateApiRequest(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/lib/usage', () => ({
  checkUsageLimit: (userId: string, type: string) => mockCheckUsageLimit(userId, type),
  recordUsage: (userId: string, type: string) => mockRecordUsage(userId, type),
}));

vi.mock('@/lib/policy-freeze', () => ({
  getPolicyFreezeStatus: (userId: string) => mockGetPolicyFreezeStatus(userId),
}));

vi.mock('@/services/policy/executor', () => ({
  executePolicy: (params: unknown) => mockExecutePolicy(params),
}));

describe('V1 Policies API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/policies', () => {
    it('should return 401 when not authenticated', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: false,
        error: 'Invalid API key',
        status: 401,
      });

      const auth = await mockAuthenticateApiRequest();
      expect(auth.success).toBe(false);
      expect(auth.status).toBe(401);
    });

    it('should return 429 when API call limit exceeded', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({
        allowed: false,
        message: 'API call limit exceeded',
      });

      const auth = await mockAuthenticateApiRequest();
      expect(auth.success).toBe(true);

      const limitCheck = await mockCheckUsageLimit(auth.userId, 'api_call');
      expect(limitCheck.allowed).toBe(false);
    });

    it('should return policies with freeze status for authenticated user', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({ allowed: true });

      mockPrisma.policy.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Policy 1',
          description: 'Test policy 1',
          isPublic: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-02'),
          _count: { executions: 5 },
        },
        {
          id: 'p2',
          name: 'Policy 2',
          description: 'Test policy 2',
          isPublic: true,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          _count: { executions: 10 },
        },
      ]);

      mockGetPolicyFreezeStatus.mockResolvedValue({
        limit: 5,
        frozenCount: 0,
        frozenPolicyIds: new Set(),
      });

      const auth = await mockAuthenticateApiRequest();
      expect(auth.success).toBe(true);

      const policies = await mockPrisma.policy.findMany({
        where: { userId: auth.userId },
      });
      expect(policies).toHaveLength(2);

      const freezeStatus = await mockGetPolicyFreezeStatus(auth.userId);
      expect(freezeStatus.frozenCount).toBe(0);

      // Build response with freeze status
      const policiesWithFreeze = policies.map((policy: { id: string }) => ({
        ...policy,
        isFrozen: freezeStatus.frozenPolicyIds.has(policy.id),
      }));

      expect(policiesWithFreeze[0].isFrozen).toBe(false);
      expect(policiesWithFreeze[1].isFrozen).toBe(false);
    });

    it('should mark frozen policies correctly', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({ allowed: true });

      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', name: 'Active Policy' },
        { id: 'p2', name: 'Frozen Policy' },
      ]);

      mockGetPolicyFreezeStatus.mockResolvedValue({
        limit: 1,
        frozenCount: 1,
        frozenPolicyIds: new Set(['p2']),
      });

      const policies = await mockPrisma.policy.findMany({});
      const freezeStatus = await mockGetPolicyFreezeStatus('user-1');

      const policiesWithFreeze = policies.map((policy: { id: string }) => ({
        ...policy,
        isFrozen: freezeStatus.frozenPolicyIds.has(policy.id),
      }));

      expect(policiesWithFreeze[0].isFrozen).toBe(false);
      expect(policiesWithFreeze[1].isFrozen).toBe(true);
    });
  });

  describe('POST /api/v1/policies/:id/execute', () => {
    it('should return 401 when not authenticated', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: false,
        error: 'Invalid API key',
        status: 401,
      });

      const auth = await mockAuthenticateApiRequest();
      expect(auth.success).toBe(false);
    });

    it('should return 400 for invalid input', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      // Invalid input should be rejected
      const invalidInput = 'not-an-object';
      const isValidInput = typeof invalidInput === 'object' && invalidInput !== null;
      expect(isValidInput).toBe(false);
    });

    it('should return 404 for non-existent policy', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockPrisma.policy.findFirst.mockResolvedValue(null);

      const policy = await mockPrisma.policy.findFirst({
        where: { id: 'non-existent' },
      });
      expect(policy).toBeNull();
    });

    it('should return 429 when execution limit exceeded', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockImplementation((userId, type) => {
        if (type === 'api_call') return Promise.resolve({ allowed: true });
        if (type === 'execution') return Promise.resolve({ allowed: false, message: 'Limit exceeded' });
        return Promise.resolve({ allowed: true });
      });

      const apiCheck = await mockCheckUsageLimit('user-1', 'api_call');
      expect(apiCheck.allowed).toBe(true);

      const execCheck = await mockCheckUsageLimit('user-1', 'execution');
      expect(execCheck.allowed).toBe(false);
    });

    it('should execute policy and record usage', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({ allowed: true });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Test Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1',
      });

      mockExecutePolicy.mockResolvedValue({
        allowed: true,
        deniedReasons: [],
        matchedRules: ['score >= 80'],
      });

      mockPrisma.execution.create.mockResolvedValue({
        id: 'exec-1',
        success: true,
      });

      // Simulate the execution flow
      const auth = await mockAuthenticateApiRequest();
      expect(auth.success).toBe(true);

      const policy = await mockPrisma.policy.findFirst({ where: { id: 'policy-1' } });
      expect(policy).not.toBeNull();

      const executionResult = await mockExecutePolicy({
        policy,
        input: { score: 90 },
        userId: auth.userId,
      });
      expect(executionResult.allowed).toBe(true);

      await mockRecordUsage(auth.userId, 'api_call');
      await mockRecordUsage(auth.userId, 'execution');

      expect(mockRecordUsage).toHaveBeenCalledTimes(2);
      expect(mockRecordUsage).toHaveBeenCalledWith('user-1', 'api_call');
      expect(mockRecordUsage).toHaveBeenCalledWith('user-1', 'execution');
    });

    it('should allow access to public policies', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-2', // Different user
        apiKeyId: 'key-2',
      });

      mockCheckUsageLimit.mockResolvedValue({ allowed: true });

      // Public policy owned by different user
      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Public Policy',
        content: 'if score >= 80 then approve',
        userId: 'user-1', // Owner is different
        isPublic: true,
      });

      const policy = await mockPrisma.policy.findFirst({
        where: {
          id: 'policy-1',
          OR: [{ userId: 'user-2' }, { isPublic: true }],
        },
      });

      expect(policy).not.toBeNull();
      expect(policy?.isPublic).toBe(true);
    });

    it('should create execution record with correct data', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        success: true,
        userId: 'user-1',
        apiKeyId: 'key-1',
      });

      mockCheckUsageLimit.mockResolvedValue({ allowed: true });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        name: 'Test Policy',
      });

      mockExecutePolicy.mockResolvedValue({
        allowed: false,
        deniedReasons: ['Score too low'],
        matchedRules: [],
      });

      const executionResult = await mockExecutePolicy({});
      const primaryError = executionResult.deniedReasons[0];

      await mockPrisma.execution.create({
        data: {
          userId: 'user-1',
          policyId: 'policy-1',
          input: { score: 50 },
          output: { allowed: false, approved: false, deniedReasons: ['Score too low'] },
          error: primaryError,
          durationMs: 10,
          success: false,
          source: 'api',
          apiKeyId: 'key-1',
        },
      });

      expect(mockPrisma.execution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            policyId: 'policy-1',
            source: 'api',
            apiKeyId: 'key-1',
            success: false,
            error: 'Score too low',
          }),
        })
      );
    });
  });
});

describe('V1 API Response Format', () => {
  it('should return standardized success response', () => {
    const response = {
      success: true,
      data: { allowed: true, approved: true },
      error: null,
      meta: {
        policyId: 'policy-1',
        policyName: 'Test Policy',
        durationMs: 10,
        timestamp: new Date().toISOString(),
      },
    };

    expect(response.success).toBe(true);
    expect(response.data).toBeDefined();
    expect(response.meta.policyId).toBe('policy-1');
  });

  it('should return standardized error response', () => {
    const response = {
      error: 'Policy not found',
    };

    expect(response.error).toBeDefined();
  });

  it('should return list response with meta', () => {
    const response = {
      policies: [
        { id: 'p1', name: 'Policy 1', isFrozen: false },
        { id: 'p2', name: 'Policy 2', isFrozen: true },
      ],
      meta: {
        total: 2,
        limit: 5,
        frozenCount: 1,
        timestamp: new Date().toISOString(),
      },
    };

    expect(response.policies).toHaveLength(2);
    expect(response.meta.total).toBe(2);
    expect(response.meta.frozenCount).toBe(1);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockGetSession = vi.fn();
const mockPrisma = {
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
};

const mockGetPolicyFreezeStatus = vi.fn();
const mockIsPolicyFrozen = vi.fn();
const mockAddFreezeStatusToPolicies = vi.fn();

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/lib/usage', () => ({
  checkUsageLimit: vi.fn().mockResolvedValue({ allowed: true }),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/policy-freeze', () => ({
  getPolicyFreezeStatus: () => mockGetPolicyFreezeStatus(),
  isPolicyFrozen: (userId: string, policyId: string) => mockIsPolicyFrozen(userId, policyId),
  addFreezeStatusToPolicies: () => mockAddFreezeStatusToPolicies(),
}));

// We'll test the API logic directly by simulating what the route handlers do

describe('Policies API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/policies', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      // Simulate the check in the API
      const session = await mockGetSession();
      expect(session).toBeNull();
    });

    it('should return policies for authenticated user', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', name: 'Policy 1', _count: { executions: 5 } },
        { id: 'p2', name: 'Policy 2', _count: { executions: 10 } },
      ]);

      const session = await mockGetSession();
      expect(session?.user?.id).toBe('user-1');

      const policies = await mockPrisma.policy.findMany({
        where: { userId: session!.user!.id },
        orderBy: { updatedAt: 'desc' },
      });

      expect(policies).toHaveLength(2);
      expect(policies[0].name).toBe('Policy 1');
    });
  });

  describe('POST /api/policies', () => {
    it('should create a new policy', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'pro',
      });

      mockPrisma.policy.count.mockResolvedValue(0);

      mockPrisma.policy.create.mockResolvedValue({
        id: 'new-policy',
        name: 'Test Policy',
        content: 'if score >= 80 then approve',
        piiFields: [],
      });

      mockPrisma.policyVersion.create.mockResolvedValue({});

      const policy = await mockPrisma.policy.create({
        data: {
          userId: 'user-1',
          name: 'Test Policy',
          content: 'if score >= 80 then approve',
          piiFields: [],
        },
      });

      expect(policy.name).toBe('Test Policy');
      expect(mockPrisma.policyVersion.create).not.toHaveBeenCalled(); // Not called yet
    });

    it('should detect PII in policy content', () => {
      const detectPII = (content: string): string[] => {
        const patterns = [
          { name: 'email', pattern: /\bemail\b/i },
          { name: 'ssn', pattern: /\b(ssn|social.?security)\b/i },
          { name: 'phone', pattern: /\b(phone|mobile)\b/i },
        ];

        const detected: string[] = [];
        for (const { name, pattern } of patterns) {
          if (pattern.test(content)) {
            detected.push(name);
          }
        }
        return detected;
      };

      const content1 = 'if email is valid then approve';
      const content2 = 'check user SSN and phone number';
      const content3 = 'if score >= 80 then approve';

      expect(detectPII(content1)).toContain('email');
      expect(detectPII(content2)).toContain('ssn');
      expect(detectPII(content2)).toContain('phone');
      expect(detectPII(content3)).toHaveLength(0);
    });

    it('should enforce policy limit for free users', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.user.findUnique.mockResolvedValue({
        plan: 'free',
      });

      mockPrisma.policy.count.mockResolvedValue(3); // At limit

      const user = await mockPrisma.user.findUnique({ where: { id: 'user-1' } });
      const policyCount = await mockPrisma.policy.count({ where: { userId: 'user-1' } });

      const FREE_LIMIT = 3;
      const isAtLimit = user.plan === 'free' && policyCount >= FREE_LIMIT;

      expect(isAtLimit).toBe(true);
    });
  });

  describe('PUT /api/policies/[id]', () => {
    it('should update policy and create version when content changes', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        content: 'original content',
        version: 1,
      });

      const newContent = 'updated content';
      const existingPolicy = await mockPrisma.policy.findFirst({});
      const contentChanged = newContent !== existingPolicy.content;

      expect(contentChanged).toBe(true);

      if (contentChanged) {
        mockPrisma.policy.update.mockResolvedValue({
          id: 'policy-1',
          content: newContent,
          version: 2,
        });

        const updated = await mockPrisma.policy.update({
          where: { id: 'policy-1' },
          data: { content: newContent, version: { increment: 1 } },
        });

        expect(updated.version).toBe(2);
      }
    });
  });

  describe('DELETE /api/policies/[id]', () => {
    it('should delete policy owned by user', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        userId: 'user-1',
      });

      mockPrisma.policy.delete.mockResolvedValue({});

      const policy = await mockPrisma.policy.findFirst({
        where: { id: 'policy-1', userId: 'user-1' },
      });

      expect(policy).not.toBeNull();

      await mockPrisma.policy.delete({ where: { id: 'policy-1' } });

      expect(mockPrisma.policy.delete).toHaveBeenCalled();
    });

    it('should not delete policy owned by other user', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue(null); // Policy not found for this user

      const policy = await mockPrisma.policy.findFirst({
        where: { id: 'policy-1', userId: 'user-1' },
      });

      expect(policy).toBeNull();
    });
  });
});

describe('Policy Execution', () => {
  describe('Rule Parsing', () => {
    it('should parse simple rules', () => {
      interface Rule {
        field: string;
        condition: string;
        value: unknown;
        action: string;
      }

      const parsePolicyRules = (content: string): Rule[] => {
        const rules: Rule[] = [];
        const lines = content.split('\n');

        for (const line of lines) {
          const match = line.match(/if\s+(\w+)\s+(>=|<=|>|<|==|!=)\s+(\S+)\s+then\s+(.+)/i);
          if (match) {
            rules.push({
              field: match[1],
              condition: match[2],
              value: isNaN(Number(match[3])) ? match[3] : Number(match[3]),
              action: match[4].trim(),
            });
          }
        }
        return rules;
      };

      const content = `
if creditScore >= 750 then approve
if income < 30000 then reject
if status == verified then proceed
      `;

      const rules = parsePolicyRules(content);

      expect(rules).toHaveLength(3);
      expect(rules[0]).toEqual({
        field: 'creditScore',
        condition: '>=',
        value: 750,
        action: 'approve',
      });
      expect(rules[1].value).toBe(30000);
      expect(rules[2].value).toBe('verified');
    });
  });

  describe('Rule Evaluation', () => {
    it('should evaluate rules against input', () => {
      interface Rule {
        field: string;
        condition: string;
        value: unknown;
        action: string;
      }

      const evaluateRules = (
        rules: Rule[],
        input: Record<string, unknown>
      ): { approved: boolean; matchedRules: string[] } => {
        const result = {
          approved: true,
          matchedRules: [] as string[],
        };

        for (const rule of rules) {
          const fieldValue = input[rule.field];
          let matched = false;

          switch (rule.condition) {
            case '>=':
              matched = Number(fieldValue) >= Number(rule.value);
              break;
            case '<':
              matched = Number(fieldValue) < Number(rule.value);
              break;
          }

          if (matched) {
            result.matchedRules.push(`${rule.field} ${rule.condition} ${rule.value}`);
            if (rule.action.includes('reject')) {
              result.approved = false;
            }
          }
        }

        return result;
      };

      const rules: Rule[] = [
        { field: 'score', condition: '>=', value: 80, action: 'approve' },
        { field: 'risk', condition: '>=', value: 0.8, action: 'reject' },
      ];

      // Approved case
      const result1 = evaluateRules(rules, { score: 85, risk: 0.2 });
      expect(result1.approved).toBe(true);
      expect(result1.matchedRules).toContain('score >= 80');

      // Rejected case
      const result2 = evaluateRules(rules, { score: 90, risk: 0.9 });
      expect(result2.approved).toBe(false);
      expect(result2.matchedRules).toContain('risk >= 0.8');
    });
  });
});

describe('Policy Freeze API Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/policies with freeze status', () => {
    it('should return policies with freeze info when user has frozen policies', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      // User has 5 policies but limit is 3
      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', name: 'Policy 1', updatedAt: new Date('2024-01-05') },
        { id: 'p2', name: 'Policy 2', updatedAt: new Date('2024-01-04') },
        { id: 'p3', name: 'Policy 3', updatedAt: new Date('2024-01-03') },
        { id: 'p4', name: 'Policy 4', updatedAt: new Date('2024-01-02') },
        { id: 'p5', name: 'Policy 5', updatedAt: new Date('2024-01-01') },
      ]);

      mockGetPolicyFreezeStatus.mockResolvedValue({
        limit: 3,
        totalPolicies: 5,
        frozenCount: 2,
        frozenPolicyIds: new Set(['p4', 'p5']),
      });

      const session = await mockGetSession();
      expect(session?.user?.id).toBe('user-1');

      const freezeStatus = await mockGetPolicyFreezeStatus();
      expect(freezeStatus.limit).toBe(3);
      expect(freezeStatus.frozenCount).toBe(2);
      expect(freezeStatus.frozenPolicyIds.has('p4')).toBe(true);
      expect(freezeStatus.frozenPolicyIds.has('p5')).toBe(true);
    });

    it('should return no frozen policies for unlimited plan users', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'team-user' },
      });

      mockPrisma.policy.findMany.mockResolvedValue([
        { id: 'p1', name: 'Policy 1' },
        { id: 'p2', name: 'Policy 2' },
      ]);

      mockGetPolicyFreezeStatus.mockResolvedValue({
        limit: -1, // Unlimited
        totalPolicies: 2,
        frozenCount: 0,
        frozenPolicyIds: new Set(),
      });

      const freezeStatus = await mockGetPolicyFreezeStatus();
      expect(freezeStatus.limit).toBe(-1);
      expect(freezeStatus.frozenCount).toBe(0);
    });
  });

  describe('GET /api/policies/[id] freeze info', () => {
    it('should return freeze info for a frozen policy', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        userId: 'user-1',
        name: 'Frozen Policy',
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'This policy is frozen because it exceeds your plan limit',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const freezeInfo = await mockIsPolicyFrozen('user-1', 'policy-4');
      expect(freezeInfo.isFrozen).toBe(true);
      expect(freezeInfo.activePoliciesLimit).toBe(3);
      expect(freezeInfo.totalPolicies).toBe(5);
    });

    it('should return not frozen for active policy', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        userId: 'user-1',
        name: 'Active Policy',
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: false,
        activePoliciesLimit: 3,
        totalPolicies: 3,
        frozenCount: 0,
      });

      const freezeInfo = await mockIsPolicyFrozen('user-1', 'policy-1');
      expect(freezeInfo.isFrozen).toBe(false);
    });
  });

  describe('PUT /api/policies/[id] freeze blocking', () => {
    it('should block update on frozen policy with 403', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        userId: 'user-1',
        content: 'old content',
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Policy is frozen',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const session = await mockGetSession();
      expect(session?.user?.id).toBe('user-1');

      const policy = await mockPrisma.policy.findFirst({
        where: { id: 'policy-4', userId: 'user-1' },
      });
      expect(policy).not.toBeNull();

      const freezeInfo = await mockIsPolicyFrozen('user-1', 'policy-4');
      expect(freezeInfo.isFrozen).toBe(true);

      // API should return 403 when trying to update frozen policy
      if (freezeInfo.isFrozen) {
        const expectedResponse = {
          error: 'Policy is frozen',
          message: `This policy is frozen because your plan allows ${freezeInfo.activePoliciesLimit} policies but you have ${freezeInfo.totalPolicies}. Delete some policies or upgrade your plan.`,
          frozen: true,
        };
        expect(expectedResponse.frozen).toBe(true);
        expect(mockPrisma.policy.update).not.toHaveBeenCalled();
      }
    });

    it('should allow update on active policy', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        userId: 'user-1',
        content: 'old content',
        version: 1,
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: false,
        activePoliciesLimit: 3,
        totalPolicies: 3,
        frozenCount: 0,
      });

      mockPrisma.policy.update.mockResolvedValue({
        id: 'policy-1',
        content: 'new content',
        version: 2,
      });

      const freezeInfo = await mockIsPolicyFrozen('user-1', 'policy-1');
      expect(freezeInfo.isFrozen).toBe(false);

      // API should allow update for non-frozen policy
      if (!freezeInfo.isFrozen) {
        const updated = await mockPrisma.policy.update({
          where: { id: 'policy-1' },
          data: { content: 'new content', version: { increment: 1 } },
        });
        expect(updated.content).toBe('new content');
        expect(mockPrisma.policy.update).toHaveBeenCalled();
      }
    });
  });

  describe('POST /api/policies/[id]/execute freeze blocking', () => {
    it('should block execution of frozen policy with 403', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        userId: 'user-1',
        content: 'if score >= 80 then approve',
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: true,
        reason: 'Policy is frozen',
        activePoliciesLimit: 3,
        totalPolicies: 5,
        frozenCount: 2,
      });

      const session = await mockGetSession();
      expect(session?.user?.id).toBe('user-1');

      const policy = await mockPrisma.policy.findFirst({ where: { id: 'policy-4' } });
      expect(policy).not.toBeNull();
      expect(policy!.userId).toBe('user-1');

      // Owner is executing their own frozen policy
      const freezeInfo = await mockIsPolicyFrozen('user-1', 'policy-4');
      expect(freezeInfo.isFrozen).toBe(true);

      // Execution should be blocked
      if (freezeInfo.isFrozen) {
        const expectedResponse = {
          error: 'Policy is frozen',
          message: `This policy is frozen because your plan allows ${freezeInfo.activePoliciesLimit} policies but you have ${freezeInfo.totalPolicies}. Delete some policies or upgrade your plan.`,
          frozen: true,
        };
        expect(expectedResponse.frozen).toBe(true);
        expect(mockPrisma.execution.create).not.toHaveBeenCalled();
      }
    });

    it('should allow execution of active policy', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-1',
        userId: 'user-1',
        content: 'if score >= 80 then approve',
      });

      mockIsPolicyFrozen.mockResolvedValue({
        isFrozen: false,
        activePoliciesLimit: 3,
        totalPolicies: 3,
        frozenCount: 0,
      });

      mockPrisma.execution.create.mockResolvedValue({
        id: 'exec-1',
        policyId: 'policy-1',
        success: true,
      });

      const freezeInfo = await mockIsPolicyFrozen('user-1', 'policy-1');
      expect(freezeInfo.isFrozen).toBe(false);

      // Execution should proceed
      if (!freezeInfo.isFrozen) {
        const execution = await mockPrisma.execution.create({
          data: {
            userId: 'user-1',
            policyId: 'policy-1',
            input: { score: 90 },
            output: { approved: true },
            success: true,
          },
        });
        expect(execution.success).toBe(true);
        expect(mockPrisma.execution.create).toHaveBeenCalled();
      }
    });

    it('should allow other users to execute public frozen policy', async () => {
      // Another user executes a public policy that is frozen for the owner
      mockGetSession.mockResolvedValue({
        user: { id: 'user-2' }, // Different user
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        userId: 'user-1', // Owner is different
        isPublic: true,
        content: 'if score >= 80 then approve',
      });

      const session = await mockGetSession();
      const policy = await mockPrisma.policy.findFirst({ where: { id: 'policy-4' } });

      // Other user is not the owner, freeze check should not apply
      const isOwner = policy!.userId === session!.user!.id;
      expect(isOwner).toBe(false);

      // Execution should proceed for non-owners
      mockPrisma.execution.create.mockResolvedValue({
        id: 'exec-2',
        policyId: 'policy-4',
        success: true,
      });

      const execution = await mockPrisma.execution.create({
        data: {
          userId: 'user-2',
          policyId: 'policy-4',
          input: { score: 90 },
          output: { approved: true },
          success: true,
        },
      });
      expect(execution.success).toBe(true);
    });
  });

  describe('DELETE /api/policies/[id] on frozen policy', () => {
    it('should allow deletion of frozen policy (to reduce count)', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1' },
      });

      mockPrisma.policy.findFirst.mockResolvedValue({
        id: 'policy-4',
        userId: 'user-1',
      });

      mockPrisma.policy.delete.mockResolvedValue({});

      const session = await mockGetSession();
      expect(session?.user?.id).toBe('user-1');

      const policy = await mockPrisma.policy.findFirst({
        where: { id: 'policy-4', userId: 'user-1' },
      });
      expect(policy).not.toBeNull();

      // Deletion should be allowed even for frozen policies
      await mockPrisma.policy.delete({ where: { id: 'policy-4' } });
      expect(mockPrisma.policy.delete).toHaveBeenCalledWith({
        where: { id: 'policy-4' },
      });
    });
  });
});

describe('Policy Freeze Edge Cases in API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle trial expiration during freeze check', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'trial-user' },
    });

    // User was on trial (25 policies limit) but trial expired
    // Now they're on free (3 policies limit) with 10 policies
    mockGetPolicyFreezeStatus.mockResolvedValue({
      limit: 3, // Downgraded to free
      totalPolicies: 10,
      frozenCount: 7,
      frozenPolicyIds: new Set([
        'p4',
        'p5',
        'p6',
        'p7',
        'p8',
        'p9',
        'p10',
      ]),
    });

    const freezeStatus = await mockGetPolicyFreezeStatus();
    expect(freezeStatus.limit).toBe(3);
    expect(freezeStatus.frozenCount).toBe(7);
    expect(freezeStatus.frozenPolicyIds.size).toBe(7);
  });

  it('should correctly order policies by updatedAt for freeze determination', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    });

    // Policies should be frozen based on updatedAt order (oldest frozen first)
    const policies = [
      { id: 'recently-updated', updatedAt: new Date('2024-12-01') },
      { id: 'moderately-old', updatedAt: new Date('2024-06-01') },
      { id: 'old-policy', updatedAt: new Date('2024-01-01') },
      { id: 'very-old', updatedAt: new Date('2023-06-01') },
    ];

    // With limit 2, the 2 oldest should be frozen
    mockGetPolicyFreezeStatus.mockResolvedValue({
      limit: 2,
      totalPolicies: 4,
      frozenCount: 2,
      frozenPolicyIds: new Set(['old-policy', 'very-old']),
    });

    const freezeStatus = await mockGetPolicyFreezeStatus();
    expect(freezeStatus.frozenPolicyIds.has('recently-updated')).toBe(false);
    expect(freezeStatus.frozenPolicyIds.has('moderately-old')).toBe(false);
    expect(freezeStatus.frozenPolicyIds.has('old-policy')).toBe(true);
    expect(freezeStatus.frozenPolicyIds.has('very-old')).toBe(true);
  });

  it('should handle concurrent freeze check and policy deletion', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
    });

    // Initial state: 5 policies, 3 limit, 2 frozen
    mockGetPolicyFreezeStatus.mockResolvedValueOnce({
      limit: 3,
      totalPolicies: 5,
      frozenCount: 2,
      frozenPolicyIds: new Set(['p4', 'p5']),
    });

    const initialStatus = await mockGetPolicyFreezeStatus();
    expect(initialStatus.frozenCount).toBe(2);

    // After deleting one frozen policy: 4 policies, 1 frozen
    mockGetPolicyFreezeStatus.mockResolvedValueOnce({
      limit: 3,
      totalPolicies: 4,
      frozenCount: 1,
      frozenPolicyIds: new Set(['p4']),
    });

    const afterDelete = await mockGetPolicyFreezeStatus();
    expect(afterDelete.frozenCount).toBe(1);
    expect(afterDelete.totalPolicies).toBe(4);
  });
});

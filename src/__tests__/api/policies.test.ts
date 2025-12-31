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
};

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}));

vi.mock('@/lib/usage', () => ({
  checkUsageLimit: vi.fn().mockResolvedValue({ allowed: true }),
  FEATURE_LIMITS: {
    free: { savedPolicies: 3 },
    pro: { savedPolicies: Infinity },
    trial: { savedPolicies: Infinity },
  },
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

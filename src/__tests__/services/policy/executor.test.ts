import { describe, it, expect } from 'vitest';
import type { Policy } from '@prisma/client';
import { executePolicy } from '@/services/policy/executor';

const basePolicy: Policy = {
  id: 'policy-base',
  userId: 'user-1',
  teamId: null,
  name: 'Base Policy',
  description: '用于测试的策略',
  content: '',
  version: 1,
  isPublic: false,
  shareSlug: null,
  piiFields: [],
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

function createPolicy(overrides: Partial<Policy> & { rules?: string | null }) {
  return {
    ...basePolicy,
    ...overrides,
  } as Policy & { rules?: string | null };
}

const mockPolicy = createPolicy({
  id: 'policy-allow',
  rules: `if amount < 500 then allow purchase\nif status == "approved" then allow`,
});

const mockPolicyWithLimit = createPolicy({
  id: 'policy-deny',
  rules: `if amount >= 10000 then deny Amount exceeds limit`,
});

describe('PolicyExecutor', () => {
  describe('executePolicy', () => {
    it('should allow when all rules pass', async () => {
      const result = await executePolicy({
        policy: mockPolicy,
        input: { amount: 100, status: 'approved' },
        userId: 'user-1',
      });

      expect(result.allowed).toBe(true);
      expect(result.matchedRules).toContain('rule-1');
      expect(result.metadata.ruleCount).toBe(2);
      expect(result.metadata.matchedRuleCount).toBe(2);
    });

    it('should deny when rule fails', async () => {
      const result = await executePolicy({
        policy: mockPolicyWithLimit,
        input: { amount: 10000 },
        userId: 'user-1',
      });

      expect(result.allowed).toBe(false);
      expect(result.deniedReasons).toContain('Amount exceeds limit');
      expect(result.metadata.denyCount).toBe(1);
    });

    it('should handle empty rules', async () => {
      const emptyPolicy = createPolicy({
        id: 'policy-empty',
        rules: '',
        content: '',
      });

      const result = await executePolicy({
        policy: emptyPolicy,
        input: {},
        userId: 'user-1',
      });

      expect(result.allowed).toBe(true);
      expect(result.matchedRules).toHaveLength(0);
      expect(result.metadata.ruleCount).toBe(0);
      expect(result.metadata.denyCount).toBe(0);
    });

    it('should include metadata in result', async () => {
      const policy = createPolicy({
        id: 'policy-meta',
        name: 'Metadata Test',
        rules: `if amount > 5000 then deny Suspicious amount`,
      });

      const result = await executePolicy({
        policy,
        input: { amount: 100 },
        userId: 'user-1',
      });

      expect(result.metadata.policyId).toBe('policy-meta');
      expect(result.metadata.policyName).toBe('Metadata Test');
      expect(new Date(result.metadata.evaluatedAt).toString()).not.toBe('Invalid Date');
      expect(result.metadata.rules[0]).toMatchObject({
        name: 'rule-1',
        field: 'amount',
        operator: 'gt',
      });
    });
  });
});

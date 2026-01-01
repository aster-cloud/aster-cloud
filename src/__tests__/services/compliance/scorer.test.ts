import { describe, it, expect } from 'vitest';
import { ComplianceScorer } from '@/services/compliance/scorer';
import type { ComplianceAggregate } from '@/services/compliance/types';

const mockComplianceData: ComplianceAggregate = {
  totalPolicies: 12,
  policiesWithPII: 3,
  totalExecutions: 200,
  piiFields: ['email', 'phone'],
  highRiskFields: [],
};

describe('ComplianceScorer', () => {
  const scorer = new ComplianceScorer();

  it('should calculate overall score within range', () => {
    const scores = scorer.calculate(mockComplianceData);

    expect(scores.overall).toBeGreaterThanOrEqual(0);
    expect(scores.overall).toBeLessThanOrEqual(100);
  });

  it('should score all categories', () => {
    const scores = scorer.calculate(mockComplianceData);

    expect(scores.categories).toHaveProperty('dataProtection');
    expect(scores.categories).toHaveProperty('accessControl');
    expect(scores.categories).toHaveProperty('auditLogging');
  });

  it('should penalize high-risk data', () => {
    const scores = scorer.calculate({
      totalPolicies: 5,
      policiesWithPII: 5,
      totalExecutions: 10,
      piiFields: ['ssn', 'credit_card', 'email', 'phone', 'name'],
      highRiskFields: ['ssn', 'credit_card'],
    });

    expect(scores.overall).toBeLessThan(100);
    expect(scores.categories.dataProtection).toBeLessThan(100);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma - use hoisted mock pattern
vi.mock('@/lib/prisma', () => ({
  prisma: {
    complianceReport: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    policy: {
      findMany: vi.fn(),
    },
  },
}));

import { generateComplianceReport, getComplianceReports } from '@/lib/compliance';
import { prisma } from '@/lib/prisma';

// Cast prisma to mocked version
const mockPrisma = vi.mocked(prisma);

describe('Compliance Report Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateComplianceReport', () => {
    it('should generate a GDPR report', async () => {
      mockPrisma.complianceReport.create.mockResolvedValue({
        id: 'report-1',
        type: 'gdpr',
        title: 'GDPR Compliance Report',
        status: 'generating',
      });

      mockPrisma.policy.findMany.mockResolvedValue([
        {
          id: 'policy-1',
          name: 'User Data Policy',
          piiFields: ['email', 'name'],
          _count: { executions: 10 },
          executions: [{ createdAt: new Date() }],
        },
      ]);

      mockPrisma.complianceReport.update.mockResolvedValue({});

      const result = await generateComplianceReport('user-1', 'gdpr');

      expect(result.type).toBe('gdpr');
      expect(result.data.summary.totalPolicies).toBe(1);
      expect(result.data.summary.policiesWithPII).toBe(1);
      expect(result.data.piiAnalysis.fieldsDetected).toContain('email');
      expect(result.data.recommendations.length).toBeGreaterThan(0);
    });

    it('should calculate compliance score based on PII', async () => {
      mockPrisma.complianceReport.create.mockResolvedValue({
        id: 'report-1',
        type: 'gdpr',
      });

      // High-risk PII
      mockPrisma.policy.findMany.mockResolvedValue([
        {
          id: 'policy-1',
          name: 'Financial Policy',
          piiFields: ['ssn', 'credit_card'],
          _count: { executions: 5 },
          executions: [],
        },
      ]);

      mockPrisma.complianceReport.update.mockResolvedValue({});

      const result = await generateComplianceReport('user-1', 'gdpr');

      // Score should be lower due to high-risk PII
      expect(result.data.summary.complianceScore).toBeLessThan(100);
      expect(result.data.piiAnalysis.riskLevel).toBe('high');
    });

    it('should give high score for policies without PII', async () => {
      mockPrisma.complianceReport.create.mockResolvedValue({
        id: 'report-1',
        type: 'soc2',
      });

      mockPrisma.policy.findMany.mockResolvedValue([
        {
          id: 'policy-1',
          name: 'Business Rules',
          piiFields: [],
          _count: { executions: 100 },
          executions: [{ createdAt: new Date() }],
        },
        {
          id: 'policy-2',
          name: 'Pricing Rules',
          piiFields: null,
          _count: { executions: 50 },
          executions: [],
        },
      ]);

      mockPrisma.complianceReport.update.mockResolvedValue({});

      const result = await generateComplianceReport('user-1', 'soc2');

      expect(result.data.summary.complianceScore).toBe(100);
      expect(result.data.piiAnalysis.riskLevel).toBe('low');
    });

    it('should filter policies when policyIds provided', async () => {
      mockPrisma.complianceReport.create.mockResolvedValue({
        id: 'report-1',
        type: 'hipaa',
      });

      mockPrisma.policy.findMany.mockResolvedValue([
        {
          id: 'policy-1',
          name: 'Health Data',
          piiFields: ['dob'],
          _count: { executions: 10 },
          executions: [],
        },
      ]);

      mockPrisma.complianceReport.update.mockResolvedValue({});

      await generateComplianceReport('user-1', 'hipaa', ['policy-1']);

      expect(mockPrisma.policy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['policy-1'] },
          }),
        })
      );
    });

    it('should handle report generation failure', async () => {
      mockPrisma.complianceReport.create.mockResolvedValue({
        id: 'report-1',
        type: 'gdpr',
      });

      mockPrisma.policy.findMany.mockRejectedValue(new Error('Database error'));
      mockPrisma.complianceReport.update.mockResolvedValue({});

      await expect(generateComplianceReport('user-1', 'gdpr')).rejects.toThrow();

      expect(mockPrisma.complianceReport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'failed' }),
        })
      );
    });
  });

  describe('getComplianceReports', () => {
    it('should return reports for user', async () => {
      mockPrisma.complianceReport.findMany.mockResolvedValue([
        { id: '1', type: 'gdpr', status: 'completed' },
        { id: '2', type: 'hipaa', status: 'completed' },
      ]);

      const result = await getComplianceReports('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.complianceReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('should respect limit parameter', async () => {
      mockPrisma.complianceReport.findMany.mockResolvedValue([]);

      await getComplianceReports('user-1', 5);

      expect(mockPrisma.complianceReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        })
      );
    });
  });
});

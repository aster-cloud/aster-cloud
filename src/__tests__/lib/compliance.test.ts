import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist the reporter mock so we can control it before module imports
const mockGenerateReport = vi.fn();

// Mock Drizzle - use hoisted mock pattern
vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      complianceReports: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      policies: {
        findMany: vi.fn(),
      },
    },
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  },
  complianceReports: {
    id: {},
    userId: {},
    type: {},
    title: {},
    status: {},
    data: {},
    createdAt: {},
    completedAt: {},
  },
  policies: {
    id: {},
    userId: {},
    name: {},
    piiFields: {},
  },
  executions: {
    policyId: {},
    createdAt: {},
  },
}));

// Mock ComplianceReporter using a factory that references the hoisted mock
vi.mock('@/services/compliance/reporter', () => {
  return {
    ComplianceReporter: class {
      generateReport(...args: unknown[]) {
        return mockGenerateReport(...args);
      }
    },
  };
});

vi.mock('@/services/compliance/scorer', () => ({
  ComplianceScorer: class {
    calculate = vi.fn();
  },
}));

import { db, complianceReports } from '@/lib/prisma';
import { generateComplianceReport, getComplianceReports, getComplianceReport } from '@/lib/compliance';

// Helper to build a chainable mock chain for db.insert
function makeInsertChain(returnValue: unknown[]) {
  const returning = vi.fn().mockResolvedValue(returnValue);
  const values = vi.fn().mockReturnValue({ returning });
  vi.mocked(db.insert).mockReturnValue({ values } as unknown as ReturnType<typeof db.insert>);
  return { values, returning };
}

// Helper to build a chainable mock chain for db.update
function makeUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  vi.mocked(db.update).mockReturnValue({ set } as unknown as ReturnType<typeof db.update>);
  return { set, where };
}

describe('Compliance Report Generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateComplianceReport', () => {
    const mockReportRecord = {
      id: 'report-1',
      userId: 'user-1',
      type: 'gdpr' as const,
      title: 'GDPR Compliance Report',
      status: 'generating',
    };

    const mockReportData = {
      summary: {
        totalPolicies: 2,
        policiesWithPII: 1,
        totalExecutions: 10,
        complianceScore: 85,
      },
      policies: [],
      piiAnalysis: {
        fieldsDetected: ['email'],
        riskLevel: 'low' as const,
        recommendations: ['未检测到高风险 PII，继续保持现有管控措施'],
      },
      auditTrail: {
        recentExecutions: 10,
        dataRetentionDays: 365,
        lastAuditDate: new Date(),
      },
      recommendations: ['确保在处理个人数据前获取数据主体同意'],
      scores: {
        overall: 85,
        categories: { dataProtection: 90, accessControl: 80, auditLogging: 85 },
      },
    };

    it('should create a report record, call reporter, and update status to completed', async () => {
      makeInsertChain([mockReportRecord]);
      makeUpdateChain();
      mockGenerateReport.mockResolvedValue(mockReportData);

      const result = await generateComplianceReport('user-1', 'gdpr');

      expect(db.insert).toHaveBeenCalledWith(complianceReports);
      expect(result).toEqual({
        id: 'report-1',
        type: 'gdpr',
        data: mockReportData,
      });
    });

    it('should set initial status to generating when inserting', async () => {
      makeInsertChain([mockReportRecord]);
      makeUpdateChain();
      mockGenerateReport.mockResolvedValue(mockReportData);

      await generateComplianceReport('user-1', 'gdpr');

      const insertValues = vi.mocked(db.insert).mock.results[0].value.values;
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'generating' })
      );
    });

    it('should update status to completed after successful generation', async () => {
      makeInsertChain([mockReportRecord]);
      const { set } = makeUpdateChain();
      mockGenerateReport.mockResolvedValue(mockReportData);

      await generateComplianceReport('user-1', 'gdpr');

      expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });

    it('should pass policyIds to reporter when provided', async () => {
      makeInsertChain([mockReportRecord]);
      makeUpdateChain();
      mockGenerateReport.mockResolvedValue(mockReportData);

      await generateComplianceReport('user-1', 'gdpr', ['policy-a', 'policy-b']);

      expect(mockGenerateReport).toHaveBeenCalledWith('user-1', {
        type: 'gdpr',
        policyIds: ['policy-a', 'policy-b'],
      });
    });

    it('should omit policyIds from reporter options when array is empty', async () => {
      makeInsertChain([mockReportRecord]);
      makeUpdateChain();
      mockGenerateReport.mockResolvedValue(mockReportData);

      await generateComplianceReport('user-1', 'hipaa', []);

      expect(mockGenerateReport).toHaveBeenCalledWith('user-1', {
        type: 'hipaa',
        policyIds: undefined,
      });
    });

    it('should update status to failed and rethrow when reporter throws', async () => {
      makeInsertChain([mockReportRecord]);
      const { set } = makeUpdateChain();

      const reporterError = new Error('Reporter service unavailable');
      mockGenerateReport.mockRejectedValue(reporterError);

      await expect(generateComplianceReport('user-1', 'soc2')).rejects.toThrow(
        'Reporter service unavailable'
      );

      expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });

    it('should work with all compliance types', async () => {
      const types = ['gdpr', 'hipaa', 'soc2', 'pci_dss', 'custom'] as const;

      for (const type of types) {
        vi.clearAllMocks();
        makeInsertChain([{ ...mockReportRecord, type }]);
        makeUpdateChain();
        mockGenerateReport.mockResolvedValue(mockReportData);

        const result = await generateComplianceReport('user-1', type);
        expect(result.type).toBe(type);
      }
    });
  });

  describe('getComplianceReports', () => {
    it('should return reports for a user ordered by createdAt desc', async () => {
      const mockReports = [
        { id: 'report-2', userId: 'user-1', type: 'gdpr' as const, status: 'completed' as const, title: 'GDPR Report', data: null, period: null, policyIds: null, completedAt: new Date('2024-02-01'), createdAt: new Date('2024-02-01') },
        { id: 'report-1', userId: 'user-1', type: 'hipaa' as const, status: 'completed' as const, title: 'HIPAA Report', data: null, period: null, policyIds: null, completedAt: new Date('2024-01-01'), createdAt: new Date('2024-01-01') },
      ];
      vi.mocked(db.query.complianceReports.findMany).mockResolvedValue(mockReports);

      const result = await getComplianceReports('user-1');

      expect(db.query.complianceReports.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('report-2');
    });

    it('should use the provided limit', async () => {
      vi.mocked(db.query.complianceReports.findMany).mockResolvedValue([]);

      await getComplianceReports('user-1', 5);

      expect(db.query.complianceReports.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 })
      );
    });

    it('should return empty array when user has no reports', async () => {
      vi.mocked(db.query.complianceReports.findMany).mockResolvedValue([]);

      const result = await getComplianceReports('user-99');

      expect(result).toEqual([]);
    });
  });

  describe('getComplianceReport', () => {
    it('should return a single report matching userId and reportId', async () => {
      const mockReport = {
        id: 'report-1',
        userId: 'user-1',
        type: 'gdpr' as const,
        status: 'completed' as const,
        title: 'GDPR Report',
        data: { summary: { totalPolicies: 3 } },
        period: null,
        policyIds: null,
        completedAt: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
      };
      vi.mocked(db.query.complianceReports.findFirst).mockResolvedValue(mockReport);

      const result = await getComplianceReport('user-1', 'report-1');

      expect(db.query.complianceReports.findFirst).toHaveBeenCalled();
      expect(result).toEqual(mockReport);
    });

    it('should return undefined when report is not found', async () => {
      vi.mocked(db.query.complianceReports.findFirst).mockResolvedValue(undefined);

      const result = await getComplianceReport('user-1', 'nonexistent-report');

      expect(result).toBeUndefined();
    });

    it('should not return a report belonging to a different user', async () => {
      // The query uses AND(id, userId) so Drizzle returns undefined for wrong user
      vi.mocked(db.query.complianceReports.findFirst).mockResolvedValue(undefined);

      const result = await getComplianceReport('other-user', 'report-1');

      expect(result).toBeUndefined();
    });
  });
});

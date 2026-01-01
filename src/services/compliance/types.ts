export type ComplianceType = 'gdpr' | 'hipaa' | 'soc2' | 'pci_dss' | 'custom';

export interface PolicyInfo {
  id: string;
  name: string;
  piiFields: string[];
  executionCount: number;
  lastExecuted: Date | null;
}

export interface ComplianceSummary {
  totalPolicies: number;
  policiesWithPII: number;
  totalExecutions: number;
  complianceScore: number;
}

export interface ComplianceScores {
  overall: number;
  categories: {
    dataProtection: number;
    accessControl: number;
    auditLogging: number;
  };
}

export interface ComplianceReportData {
  summary: ComplianceSummary;
  policies: PolicyInfo[];
  piiAnalysis: {
    fieldsDetected: string[];
    riskLevel: 'low' | 'medium' | 'high';
    recommendations: string[];
  };
  auditTrail: {
    recentExecutions: number;
    dataRetentionDays: number;
    lastAuditDate: Date;
  };
  recommendations: string[];
  scores: ComplianceScores;
}

export interface ComplianceAggregate {
  totalPolicies: number;
  policiesWithPII: number;
  totalExecutions: number;
  piiFields: string[];
  highRiskFields: string[];
}

export interface ReportOptions {
  type: ComplianceType;
  policyIds?: string[];
}

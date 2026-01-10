/**
 * Demo 模式模拟数据
 *
 * 此文件提供 Demo 模式所需的所有模拟数据，无需调用真实 API。
 * 用于展示 Aster Cloud 功能，不依赖数据库或后端服务。
 */

export interface MockDemoPolicy {
  id: string;
  name: string;
  description: string | null;
  content: string;
  piiFields: string[] | null;
  createdAt: string;
  updatedAt: string;
  _count: {
    executions: number;
  };
}

export interface MockDemoSession {
  id: string;
  expiresAt: string;
  timeRemaining: string;
  createdAt: string;
}

export interface MockDemoLimits {
  policies: {
    current: number;
    max: number;
  };
  maxPolicies: number;
  sessionTTLHours: number;
}

// 模拟会话数据
export const MOCK_DEMO_SESSION: MockDemoSession = {
  id: 'demo-session-mock-001',
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  timeRemaining: '23h 59m',
  createdAt: new Date().toISOString(),
};

// 模拟限制数据
export const MOCK_DEMO_LIMITS: MockDemoLimits = {
  policies: {
    current: 3,
    max: 10,
  },
  maxPolicies: 10,
  sessionTTLHours: 24,
};

// 模拟策略数据
export const MOCK_DEMO_POLICIES: MockDemoPolicy[] = [
  {
    id: 'demo-policy-001',
    name: 'Loan Application Policy',
    description: 'Evaluates loan applications based on credit score and income',
    content: `This module is LoanPolicy.

Define Applicant with
  id as text,
  creditScore as integer,
  income as decimal,
  debtToIncomeRatio as decimal,
  loanAmount as decimal.

Define Result with
  approved as boolean,
  reason as text,
  maxAmount as decimal.

Evaluate loan with applicant: Applicant, producing result:
  If the creditScore of applicant is at least 700 and
     the income of applicant is at least 50000 and
     the debtToIncomeRatio of applicant is at most 0.4 then
    Return Result with approved as true, reason as "Approved based on excellent credit", maxAmount as the loanAmount of applicant.
  If the creditScore of applicant is at least 650 then
    Return Result with approved as true, reason as "Approved with conditions", maxAmount as 25000.
  Otherwise
    Return Result with approved as false, reason as "Credit score below minimum threshold", maxAmount as 0.`,
    piiFields: ['id', 'creditScore', 'income'],
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    _count: {
      executions: 15,
    },
  },
  {
    id: 'demo-policy-002',
    name: 'Fraud Detection Policy',
    description: 'Detects potentially fraudulent transactions',
    content: `This module is FraudDetection.

Define Transaction with
  amount as decimal,
  merchantCategory as text,
  isInternational as boolean,
  hourOfDay as integer.

Define FraudResult with
  isSuspicious as boolean,
  riskLevel as text,
  reason as text.

Check fraud with transaction: Transaction, producing result:
  If the amount of transaction is greater than 5000 and
     the isInternational of transaction is true then
    Return FraudResult with isSuspicious as true, riskLevel as "HIGH", reason as "Large international transaction".
  If the hourOfDay of transaction is less than 6 and
     the amount of transaction is greater than 1000 then
    Return FraudResult with isSuspicious as true, riskLevel as "MEDIUM", reason as "Late night high-value transaction".
  Otherwise
    Return FraudResult with isSuspicious as false, riskLevel as "LOW", reason as "Transaction appears normal".`,
    piiFields: null,
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    _count: {
      executions: 28,
    },
  },
  {
    id: 'demo-policy-003',
    name: 'User Verification Policy',
    description: 'Verifies user identity and eligibility',
    content: `This module is UserVerification.

Define User with
  email as text,
  phoneVerified as boolean,
  documentsSubmitted as boolean,
  accountAge as integer.

Define VerificationResult with
  verified as boolean,
  level as text,
  nextStep as text.

Verify user with user: User, producing result:
  If the phoneVerified of user is true and
     the documentsSubmitted of user is true and
     the accountAge of user is at least 30 then
    Return VerificationResult with verified as true, level as "FULL", nextStep as "None required".
  If the phoneVerified of user is true then
    Return VerificationResult with verified as true, level as "BASIC", nextStep as "Submit identity documents".
  Otherwise
    Return VerificationResult with verified as false, level as "NONE", nextStep as "Verify phone number".`,
    piiFields: ['email'],
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    _count: {
      executions: 42,
    },
  },
];

// 模拟执行结果
export interface MockExecutionResult {
  executionId: string;
  success: boolean;
  output?: {
    matchedRules: string[];
    actions: string[];
    approved: boolean;
  };
  error?: string;
  durationMs: number;
}

export function getMockExecutionResult(policyId: string, input: unknown): MockExecutionResult {
  const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // 根据策略 ID 返回不同的模拟结果
  switch (policyId) {
    case 'demo-policy-001': {
      const applicant = input as { creditScore?: number; income?: number };
      const approved = (applicant?.creditScore ?? 0) >= 700 && (applicant?.income ?? 0) >= 50000;
      return {
        executionId,
        success: true,
        output: {
          matchedRules: approved
            ? ['Credit score check passed', 'Income requirement met']
            : ['Credit score below threshold'],
          actions: approved ? ['Approve loan'] : ['Reject application', 'Send rejection notice'],
          approved,
        },
        durationMs: Math.floor(Math.random() * 50) + 10,
      };
    }
    case 'demo-policy-002': {
      const transaction = input as { amount?: number; isInternational?: boolean };
      const isSuspicious = (transaction?.amount ?? 0) > 5000 && transaction?.isInternational;
      return {
        executionId,
        success: true,
        output: {
          matchedRules: isSuspicious
            ? ['Large international transaction detected']
            : ['Transaction within normal parameters'],
          actions: isSuspicious ? ['Flag for review', 'Send alert'] : ['Allow transaction'],
          approved: !isSuspicious,
        },
        durationMs: Math.floor(Math.random() * 30) + 5,
      };
    }
    case 'demo-policy-003': {
      const user = input as { phoneVerified?: boolean; documentsSubmitted?: boolean };
      const verified = user?.phoneVerified && user?.documentsSubmitted;
      return {
        executionId,
        success: true,
        output: {
          matchedRules: verified
            ? ['Phone verified', 'Documents submitted']
            : ['Verification incomplete'],
          actions: verified ? ['Grant full access'] : ['Request additional verification'],
          approved: verified ?? false,
        },
        durationMs: Math.floor(Math.random() * 40) + 8,
      };
    }
    default:
      return {
        executionId,
        success: true,
        output: {
          matchedRules: ['Default rule applied'],
          actions: ['Process completed'],
          approved: true,
        },
        durationMs: Math.floor(Math.random() * 20) + 5,
      };
  }
}

// 获取单个策略
export function getMockPolicy(policyId: string): MockDemoPolicy | null {
  return MOCK_DEMO_POLICIES.find(p => p.id === policyId) ?? null;
}

// 更新会话剩余时间（模拟时间流逝）
export function getUpdatedTimeRemaining(): string {
  const now = new Date();
  const expires = new Date(MOCK_DEMO_SESSION.expiresAt);
  const remaining = expires.getTime() - now.getTime();

  if (remaining <= 0) return '0h 0m';

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

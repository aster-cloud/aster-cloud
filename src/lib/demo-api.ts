/**
 * Demo API 客户端层
 *
 * 提供与真实 API 相同的接口，但数据存储在 localStorage 中。
 * 模拟网络延迟和 API 响应格式，确保与生产环境一致的体验。
 */

import {
  getOrCreateSession,
  getSession,
  getSessionTimeRemaining,
  getPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  deletePolicy,
  getExecutions,
  createExecution,
  checkRateLimit,
  incrementRateLimit,
  getDemoStats,
  initializeWithExamples,
  clearAllDemoData,
  DEMO_LIMITS,
  type DemoSession,
  type DemoPolicy,
  type DemoExecution,
} from './demo-storage';

// 模拟网络延迟（50-200ms）
function simulateDelay(): Promise<void> {
  const delay = 50 + Math.random() * 150;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// API 响应类型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ==================== 会话 API ====================

export interface SessionResponse {
  session: {
    id: string;
    expiresAt: string;
    timeRemaining: string;
    createdAt: string;
  };
  limits: {
    policies: { current: number; max: number };
    maxPolicies: number;
    sessionTTLHours: number;
  };
}

export async function fetchDemoSession(): Promise<ApiResponse<SessionResponse>> {
  await simulateDelay();

  try {
    const session = getOrCreateSession();
    const stats = getDemoStats();

    // 首次会话时初始化示例数据
    if (stats.policies.current === 0) {
      initializeWithExamples();
    }

    const updatedStats = getDemoStats();

    return {
      success: true,
      data: {
        session: {
          id: session.id,
          expiresAt: session.expiresAt,
          timeRemaining: getSessionTimeRemaining(),
          createdAt: session.createdAt,
        },
        limits: {
          policies: updatedStats.policies,
          maxPolicies: DEMO_LIMITS.maxPolicies,
          sessionTTLHours: DEMO_LIMITS.sessionTTLHours,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch session',
    };
  }
}

export async function refreshDemoSession(): Promise<ApiResponse<SessionResponse>> {
  return fetchDemoSession();
}

export async function clearDemoSession(): Promise<ApiResponse<void>> {
  await simulateDelay();
  clearAllDemoData();
  return { success: true };
}

// ==================== 策略 API ====================

export interface PolicyListResponse {
  policies: (DemoPolicy & { _count: { executions: number } })[];
  total: number;
}

export async function fetchDemoPolicies(options?: {
  include?: string[];
}): Promise<ApiResponse<PolicyListResponse>> {
  await simulateDelay();

  try {
    const session = getSession();
    if (!session) {
      return { success: false, error: 'No active demo session' };
    }

    const policies = getPolicies();
    const executions = getExecutions();

    // 添加执行计数
    const policiesWithCount = policies.map((policy) => ({
      ...policy,
      _count: {
        executions: executions.filter((e) => e.policyId === policy.id).length,
      },
    }));

    return {
      success: true,
      data: {
        policies: policiesWithCount,
        total: policies.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch policies',
    };
  }
}

export interface PolicyDetailResponse extends DemoPolicy {
  _count: { executions: number };
  versions: Array<{
    id: string;
    version: number;
    comment: string | null;
    createdAt: string;
  }>;
}

export async function fetchDemoPolicy(
  policyId: string
): Promise<ApiResponse<PolicyDetailResponse>> {
  await simulateDelay();

  try {
    const session = getSession();
    if (!session) {
      return { success: false, error: 'No active demo session' };
    }

    const policy = getPolicy(policyId);
    if (!policy) {
      return { success: false, error: 'Policy not found' };
    }

    const executions = getExecutions(policyId);

    return {
      success: true,
      data: {
        ...policy,
        _count: { executions: executions.length },
        versions: [
          {
            id: `${policy.id}-v${policy.version}`,
            version: policy.version,
            comment: policy.version === 1 ? 'Initial version' : 'Updated',
            createdAt: policy.version === 1 ? policy.createdAt : policy.updatedAt,
          },
        ],
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch policy',
    };
  }
}

export async function createDemoPolicy(data: {
  name: string;
  description?: string;
  content: string;
  piiFields?: string[];
  defaultInput?: Record<string, unknown>;
}): Promise<ApiResponse<DemoPolicy>> {
  await simulateDelay();

  try {
    const session = getSession();
    if (!session) {
      return { success: false, error: 'No active demo session' };
    }

    const stats = getDemoStats();
    if (stats.policies.current >= stats.policies.max) {
      return {
        success: false,
        error: `Demo limit reached: maximum ${stats.policies.max} policies allowed`,
      };
    }

    const policy = createPolicy(data);
    return { success: true, data: policy };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create policy',
    };
  }
}

export async function updateDemoPolicy(
  policyId: string,
  data: {
    name?: string;
    description?: string;
    content?: string;
    piiFields?: string[];
    defaultInput?: Record<string, unknown>;
  }
): Promise<ApiResponse<DemoPolicy>> {
  await simulateDelay();

  try {
    const session = getSession();
    if (!session) {
      return { success: false, error: 'No active demo session' };
    }

    const policy = updatePolicy(policyId, data);
    if (!policy) {
      return { success: false, error: 'Policy not found' };
    }

    return { success: true, data: policy };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update policy',
    };
  }
}

export async function deleteDemoPolicy(
  policyId: string
): Promise<ApiResponse<void>> {
  await simulateDelay();

  try {
    const session = getSession();
    if (!session) {
      return { success: false, error: 'No active demo session' };
    }

    const success = deletePolicy(policyId);
    if (!success) {
      return { success: false, error: 'Policy not found' };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete policy',
    };
  }
}

// ==================== 执行 API ====================

export interface ExecutionResult {
  id: string;
  success: boolean;
  output: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
}

export async function executeDemoPolicy(
  policyId: string,
  input: Record<string, unknown>
): Promise<ApiResponse<{ execution: ExecutionResult }>> {
  // 检查限流
  const rateLimit = checkRateLimit();
  if (!rateLimit.allowed) {
    const resetInMinutes = Math.ceil(rateLimit.resetIn / 60000);
    return {
      success: false,
      error: `Rate limit exceeded. Please try again in ${resetInMinutes} minutes.`,
    };
  }

  // 模拟执行延迟（100-500ms）
  const executionDelay = 100 + Math.random() * 400;
  await new Promise((resolve) => setTimeout(resolve, executionDelay));

  try {
    const session = getSession();
    if (!session) {
      return { success: false, error: 'No active demo session' };
    }

    const policy = getPolicy(policyId);
    if (!policy) {
      return { success: false, error: 'Policy not found' };
    }

    // 增加限流计数
    incrementRateLimit();

    // 模拟策略执行结果
    const mockOutput = generateMockOutput(policyId, input);
    const durationMs = Math.round(executionDelay);

    const execution = createExecution({
      policyId,
      input,
      output: mockOutput,
      success: true,
      durationMs,
    });

    return {
      success: true,
      data: {
        execution: {
          id: execution.id,
          success: true,
          output: mockOutput,
          error: null,
          durationMs,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Execution failed',
    };
  }
}

// 根据策略 ID 和输入生成模拟输出
function generateMockOutput(
  policyId: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  // 获取策略内容来判断类型
  const policy = getPolicy(policyId);
  const content = policy?.content || '';

  // 贷款策略
  if (content.includes('LoanPolicy') || content.includes('creditScore')) {
    const applicant = (input.applicant || input) as Record<string, unknown>;
    const creditScore = (applicant?.creditScore as number) || 0;
    const income = (applicant?.income as number) || 0;
    const dti = (applicant?.debtToIncomeRatio as number) || 1;

    if (creditScore >= 700 && income >= 50000 && dti <= 0.4) {
      return {
        decision: 'APPROVED',
        approved: true,
        reason: 'Approved based on excellent credit',
        maxAmount: applicant?.loanAmount || 50000,
        matchedRules: ['Credit score >= 700', 'Income >= 50000', 'DTI <= 0.4'],
        actions: ['Approve loan', 'Send approval notification'],
      };
    } else if (creditScore >= 650) {
      return {
        decision: 'APPROVED',
        approved: true,
        reason: 'Approved with conditions',
        maxAmount: 25000,
        matchedRules: ['Credit score >= 650'],
        actions: ['Approve with conditions', 'Request additional documents'],
      };
    } else {
      return {
        decision: 'REJECTED',
        approved: false,
        reason: 'Credit score below minimum threshold',
        maxAmount: 0,
        matchedRules: ['Credit score < 650'],
        actions: ['Reject application', 'Send rejection notice'],
      };
    }
  }

  // 欺诈检测策略
  if (content.includes('FraudDetection') || content.includes('isSuspicious')) {
    const transaction = (input.transaction || input) as Record<string, unknown>;
    const amount = (transaction?.amount as number) || 0;
    const isInternational = transaction?.isInternational as boolean;
    const hourOfDay = (transaction?.hourOfDay as number) || 12;

    if (amount > 5000 && isInternational) {
      return {
        decision: 'REVIEW',
        isSuspicious: true,
        riskLevel: 'HIGH',
        reason: 'Large international transaction',
        matchedRules: ['Amount > 5000', 'International transaction'],
        actions: ['Flag for review', 'Send alert to fraud team'],
      };
    } else if (hourOfDay < 6 && amount > 1000) {
      return {
        decision: 'REVIEW',
        isSuspicious: true,
        riskLevel: 'MEDIUM',
        reason: 'Late night high-value transaction',
        matchedRules: ['Hour < 6', 'Amount > 1000'],
        actions: ['Flag for review'],
      };
    } else {
      return {
        decision: 'APPROVED',
        isSuspicious: false,
        riskLevel: 'LOW',
        reason: 'Transaction appears normal',
        matchedRules: ['Normal transaction pattern'],
        actions: ['Allow transaction'],
      };
    }
  }

  // 默认输出
  return {
    decision: 'PROCESSED',
    success: true,
    message: 'Policy executed successfully',
    input: input,
    matchedRules: ['Default rule'],
    actions: ['Process completed'],
  };
}

// ==================== 限流状态 API ====================

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetIn: number;
}

export async function getRateLimitStatus(): Promise<ApiResponse<RateLimitStatus>> {
  const rateLimit = checkRateLimit();
  return {
    success: true,
    data: {
      allowed: rateLimit.allowed,
      remaining: rateLimit.remaining,
      limit: DEMO_LIMITS.maxExecutionsPerHour,
      resetIn: rateLimit.resetIn,
    },
  };
}

/**
 * Demo 模式 localStorage 存储服务
 *
 * 提供类似数据库的 CRUD 操作，数据存储在 localStorage 中。
 * 支持会话管理、数据持久化和自动过期清理。
 */

// 存储键前缀
const STORAGE_PREFIX = 'aster_demo_';
const KEYS = {
  SESSION: `${STORAGE_PREFIX}session`,
  POLICIES: `${STORAGE_PREFIX}policies`,
  EXECUTIONS: `${STORAGE_PREFIX}executions`,
  RATE_LIMIT: `${STORAGE_PREFIX}rate_limit`,
};

// 会话 TTL（24 小时）
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// 限制配置
export const DEMO_LIMITS = {
  maxPolicies: 10,
  maxExecutionsPerHour: 100,
  sessionTTLHours: 24,
};

// 类型定义
export interface DemoSession {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface DemoPolicy {
  id: string;
  name: string;
  description: string | null;
  content: string;
  piiFields: string[] | null;
  defaultInput: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DemoExecution {
  id: string;
  policyId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  success: boolean;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

export interface RateLimitInfo {
  count: number;
  resetAt: string;
}

// 工具函数
function generateId(): string {
  return `demo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function isClient(): boolean {
  return typeof window !== 'undefined';
}

function getStorage<T>(key: string): T | null {
  if (!isClient()) return null;
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function setStorage<T>(key: string, data: T): void {
  if (!isClient()) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

function removeStorage(key: string): void {
  if (!isClient()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ==================== 会话管理 ====================

export function getSession(): DemoSession | null {
  const session = getStorage<DemoSession>(KEYS.SESSION);
  if (!session) return null;

  // 检查是否过期
  if (new Date(session.expiresAt) < new Date()) {
    clearAllDemoData();
    return null;
  }

  return session;
}

export function createSession(): DemoSession {
  const now = new Date();
  const session: DemoSession = {
    id: generateId(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  };
  setStorage(KEYS.SESSION, session);

  // 初始化空的策略列表
  if (!getStorage<DemoPolicy[]>(KEYS.POLICIES)) {
    setStorage(KEYS.POLICIES, []);
  }

  return session;
}

export function getOrCreateSession(): DemoSession {
  const existing = getSession();
  if (existing) return existing;
  return createSession();
}

export function getSessionTimeRemaining(): string {
  const session = getSession();
  if (!session) return '0h 0m';

  const remaining = new Date(session.expiresAt).getTime() - Date.now();
  if (remaining <= 0) return '0h 0m';

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

// ==================== 策略管理 ====================

export function getPolicies(): DemoPolicy[] {
  return getStorage<DemoPolicy[]>(KEYS.POLICIES) || [];
}

export function getPolicy(id: string): DemoPolicy | null {
  const policies = getPolicies();
  return policies.find((p) => p.id === id) || null;
}

export function createPolicy(data: {
  name: string;
  description?: string;
  content: string;
  piiFields?: string[];
  defaultInput?: Record<string, unknown>;
}): DemoPolicy {
  const policies = getPolicies();

  if (policies.length >= DEMO_LIMITS.maxPolicies) {
    throw new Error(`Demo limit reached: maximum ${DEMO_LIMITS.maxPolicies} policies allowed`);
  }

  const now = new Date().toISOString();
  const policy: DemoPolicy = {
    id: generateId(),
    name: data.name,
    description: data.description || null,
    content: data.content,
    piiFields: data.piiFields || null,
    defaultInput: data.defaultInput || null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  policies.push(policy);
  setStorage(KEYS.POLICIES, policies);

  return policy;
}

export function updatePolicy(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    content: string;
    piiFields: string[];
    defaultInput: Record<string, unknown>;
  }>
): DemoPolicy | null {
  const policies = getPolicies();
  const index = policies.findIndex((p) => p.id === id);

  if (index === -1) return null;

  const policy = policies[index];
  const updated: DemoPolicy = {
    ...policy,
    ...data,
    version: policy.version + 1,
    updatedAt: new Date().toISOString(),
  };

  policies[index] = updated;
  setStorage(KEYS.POLICIES, policies);

  return updated;
}

export function deletePolicy(id: string): boolean {
  const policies = getPolicies();
  const filtered = policies.filter((p) => p.id !== id);

  if (filtered.length === policies.length) return false;

  setStorage(KEYS.POLICIES, filtered);

  // 同时删除相关的执行记录
  const executions = getExecutions();
  const filteredExecutions = executions.filter((e) => e.policyId !== id);
  setStorage(KEYS.EXECUTIONS, filteredExecutions);

  return true;
}

// ==================== 执行记录管理 ====================

export function getExecutions(policyId?: string): DemoExecution[] {
  const executions = getStorage<DemoExecution[]>(KEYS.EXECUTIONS) || [];
  if (policyId) {
    return executions.filter((e) => e.policyId === policyId);
  }
  return executions;
}

export function createExecution(data: {
  policyId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  success: boolean;
  error?: string;
  durationMs: number;
}): DemoExecution {
  const executions = getExecutions();

  const execution: DemoExecution = {
    id: generateId(),
    policyId: data.policyId,
    input: data.input,
    output: data.output,
    success: data.success,
    error: data.error || null,
    durationMs: data.durationMs,
    createdAt: new Date().toISOString(),
  };

  executions.push(execution);
  setStorage(KEYS.EXECUTIONS, executions);

  return execution;
}

// ==================== 限流管理 ====================

export function checkRateLimit(): { allowed: boolean; remaining: number; resetIn: number } {
  const now = new Date();
  const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

  let rateLimit = getStorage<RateLimitInfo>(KEYS.RATE_LIMIT);

  // 如果没有记录或已重置，创建新记录
  if (!rateLimit || new Date(rateLimit.resetAt) <= now) {
    rateLimit = {
      count: 0,
      resetAt: hourEnd.toISOString(),
    };
    setStorage(KEYS.RATE_LIMIT, rateLimit);
  }

  const remaining = DEMO_LIMITS.maxExecutionsPerHour - rateLimit.count;
  const resetIn = Math.max(0, new Date(rateLimit.resetAt).getTime() - now.getTime());

  return {
    allowed: remaining > 0,
    remaining,
    resetIn,
  };
}

export function incrementRateLimit(): void {
  const rateLimit = getStorage<RateLimitInfo>(KEYS.RATE_LIMIT);
  if (rateLimit) {
    rateLimit.count++;
    setStorage(KEYS.RATE_LIMIT, rateLimit);
  }
}

// ==================== 数据统计 ====================

export function getDemoStats(): {
  policies: { current: number; max: number };
  executions: { total: number; thisHour: number; maxPerHour: number };
  session: { timeRemaining: string; expiresAt: string | null };
} {
  const policies = getPolicies();
  const executions = getExecutions();
  const session = getSession();
  const rateLimit = checkRateLimit();

  // 计算本小时执行次数
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const executionsThisHour = executions.filter(
    (e) => new Date(e.createdAt) > hourAgo
  ).length;

  return {
    policies: {
      current: policies.length,
      max: DEMO_LIMITS.maxPolicies,
    },
    executions: {
      total: executions.length,
      thisHour: executionsThisHour,
      maxPerHour: DEMO_LIMITS.maxExecutionsPerHour,
    },
    session: {
      timeRemaining: getSessionTimeRemaining(),
      expiresAt: session?.expiresAt || null,
    },
  };
}

// ==================== 清理 ====================

export function clearAllDemoData(): void {
  removeStorage(KEYS.SESSION);
  removeStorage(KEYS.POLICIES);
  removeStorage(KEYS.EXECUTIONS);
  removeStorage(KEYS.RATE_LIMIT);
}

// ==================== 初始化示例数据 ====================

export function initializeWithExamples(): void {
  const policies = getPolicies();
  if (policies.length > 0) return; // 已有数据，不初始化

  // 添加示例策略
  const examples = [
    {
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
      defaultInput: {
        applicant: {
          id: 'APP-001',
          creditScore: 720,
          income: 65000,
          debtToIncomeRatio: 0.35,
          loanAmount: 25000,
        },
      },
    },
    {
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
      defaultInput: {
        transaction: {
          amount: 1500,
          merchantCategory: 'retail',
          isInternational: false,
          hourOfDay: 14,
        },
      },
    },
  ];

  for (const example of examples) {
    createPolicy(example);
  }
}

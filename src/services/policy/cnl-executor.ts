/**
 * Aster CNL 策略执行服务
 *
 * 提供共享的 CNL 格式检测、语言识别和策略执行功能。
 * 供 Dashboard 和 API v1 两个执行端点复用。
 */

import { createPolicyApiClient, PolicyApiError, type PolicyEvaluateResponse } from './policy-api';
import { executePolicy as executeSimplePolicy } from './executor';
import type { Policy } from '@prisma/client';

// CNL 必须特征模式 - 这些是 CNL 独有的，简单 DSL 不具备
const CNL_REQUIRED_PATTERNS = [
  /^\s*(module|模块)\s+/m, // 模块声明
  /^\s*(type|类型)\s+\w+/m, // 类型定义（后面必须有类型名）
  /^\s*(function|函数)\s+\w+/m, // 函数定义（后面必须有函数名）
  /^\s*capability\s+\w+/m, // 能力声明
  /^\s*use\s+\w+/m, // use 导入
];

// 中文 CNL 关键字
const CHINESE_KEYWORDS = ['模块', '类型', '函数', '当', '则', '如果', '那么', '并且', '或者'];

/**
 * 检测策略内容是否为 Aster CNL 格式
 *
 * CNL 格式必须包含以下结构化语法之一：
 * - module/模块 声明
 * - type/类型 定义
 * - function/函数 定义
 * - capability 能力声明
 * - use 导入语句
 *
 * 注意：简单的 "if ... then ..." 规则不被视为 CNL，
 * 因为本地 DSL 也使用相同语法，应由简单执行器处理。
 */
export function isAsterCNL(content: string): boolean {
  if (!content || content.trim().length === 0) {
    return false;
  }
  // 必须匹配至少一个 CNL 独有特征
  return CNL_REQUIRED_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * 检测 CNL 语言类型（中文/英文）
 */
export function detectCNLLocale(content: string): string {
  const hasChineseKeywords = CHINESE_KEYWORDS.some((keyword) => content.includes(keyword));
  return hasChineseKeywords ? 'zh-CN' : 'en-US';
}

/**
 * 策略执行结果类型
 */
export interface PolicyExecutionResult {
  /** 是否允许 */
  allowed: boolean;
  /** 等同于 allowed，为兼容性保留 */
  approved: boolean;
  /** 匹配的规则列表 */
  matchedRules: string[];
  /** 拒绝原因列表 */
  deniedReasons: string[];
  /** 元数据 */
  metadata: {
    evaluatedAt: string;
    policyId: string;
    policyName: string;
    ruleCount: number;
    matchedRuleCount: number;
    denyCount: number;
    engine: 'aster-cnl' | 'simple';
    executionTime?: number;
    policyVersion?: string;
    engineError?: boolean;
    /** 简单规则引擎的规则详情 */
    rules?: Array<{
      name: string;
      action: string;
      field: string;
      operator: string;
      expected: unknown;
      actual: unknown;
      matched: boolean;
    }>;
  };
  /** CNL 引擎返回的原始结果 */
  result?: unknown;
}

/**
 * 执行策略选项
 */
export interface ExecutePolicyOptions {
  /** 策略实体 */
  policy: Policy;
  /** 输入上下文 */
  input: Record<string, unknown>;
  /** 执行用户 ID */
  userId: string;
  /** 租户 ID（可选，默认使用策略的 teamId 或 userId） */
  tenantId?: string;
}

/**
 * 统一的策略执行入口
 *
 * 自动检测策略格式并选择合适的执行引擎：
 * - CNL 格式：使用 Aster Policy API
 * - 简单规则格式：使用本地执行器
 */
export async function executePolicyUnified(
  options: ExecutePolicyOptions
): Promise<PolicyExecutionResult> {
  const { policy, input, userId, tenantId } = options;
  const policyContent = policy.content || '';
  const useAsterEngine = isAsterCNL(policyContent);

  if (useAsterEngine) {
    return executeWithAsterEngine(policy, policyContent, input, userId, tenantId);
  } else {
    return executeWithSimpleEngine(policy, policyContent, input, userId);
  }
}

/**
 * 使用 Aster CNL 引擎执行策略
 */
async function executeWithAsterEngine(
  policy: Policy,
  policyContent: string,
  input: Record<string, unknown>,
  userId: string,
  tenantId?: string
): Promise<PolicyExecutionResult> {
  try {
    const effectiveTenantId = tenantId || policy.teamId || policy.userId;
    const apiClient = createPolicyApiClient(effectiveTenantId, userId);
    const locale = detectCNLLocale(policyContent);

    const apiResponse = await apiClient.evaluateSource(policyContent, input, { locale });

    return buildCNLResult(policy, apiResponse);
  } catch (error) {
    return buildCNLErrorResult(policy, error);
  }
}

/**
 * 使用简单规则引擎执行策略
 */
async function executeWithSimpleEngine(
  policy: Policy,
  policyContent: string,
  input: Record<string, unknown>,
  userId: string
): Promise<PolicyExecutionResult> {
  const result = await executeSimplePolicy({
    policy,
    input,
    userId,
  });

  // 从返回的 metadata 中提取字段
  const meta = result.metadata as Record<string, unknown>;
  const ruleCount = (meta.ruleCount as number) || 0;
  const matchedRuleCount = (meta.matchedRuleCount as number) || 0;
  const denyCount = (meta.denyCount as number) || 0;
  const evaluatedAt = (meta.evaluatedAt as string) || new Date().toISOString();
  // 保留规则详情，供 Dashboard/API 展示命中链路与审计
  const rules = meta.rules as PolicyExecutionResult['metadata']['rules'];

  // 安全检查：如果策略内容非空但没有匹配规则，说明解析失败
  if (policyContent.trim().length > 0 && result.matchedRules.length === 0 && ruleCount === 0) {
    console.warn('[CNLExecutor] Policy content exists but no rules parsed, failing safely');
    return {
      allowed: false,
      approved: false,
      matchedRules: [],
      deniedReasons: ['Policy could not be parsed. Please check the policy syntax.'],
      metadata: {
        evaluatedAt: new Date().toISOString(),
        policyId: policy.id,
        policyName: policy.name,
        ruleCount: 0,
        matchedRuleCount: 0,
        denyCount: 1,
        engine: 'simple',
      },
    };
  }

  return {
    allowed: result.allowed,
    approved: result.allowed,
    matchedRules: result.matchedRules,
    deniedReasons: result.deniedReasons,
    metadata: {
      evaluatedAt,
      policyId: policy.id,
      policyName: policy.name,
      ruleCount,
      matchedRuleCount,
      denyCount,
      engine: 'simple',
      rules,
    },
  };
}

/**
 * 构建 CNL 执行成功结果
 * 安全原则：fail-closed，未明确允许即拒绝
 */
function buildCNLResult(policy: Policy, apiResponse: PolicyEvaluateResponse): PolicyExecutionResult {
  const resultObj = apiResponse.result as { approved?: boolean; reason?: string; reasons?: string[] } | undefined;
  // fail-closed: 仅当 success=true 且 approved=true 时才允许
  const allowed = apiResponse.success && resultObj?.approved === true;

  // 构建拒绝原因列表
  const deniedReasons: string[] = [];
  if (apiResponse.error) {
    deniedReasons.push(apiResponse.error);
  } else if (!allowed) {
    // CNL 评估结果为拒绝或缺失 approved 字段时，记录原因
    if (resultObj?.reasons && Array.isArray(resultObj.reasons)) {
      deniedReasons.push(...resultObj.reasons);
    } else if (resultObj?.reason) {
      deniedReasons.push(resultObj.reason);
    } else if (resultObj?.approved === false) {
      deniedReasons.push('Policy evaluation result: denied');
    } else {
      // approved 字段缺失，可能是上游 bug，打印警告并拒绝
      console.warn('[CNLExecutor] Missing approved field in CNL result, failing safely');
      deniedReasons.push('Policy evaluation failed: missing approval status');
    }
  }

  return {
    allowed,
    approved: allowed,
    matchedRules: [],
    deniedReasons,
    metadata: {
      evaluatedAt: new Date().toISOString(),
      policyId: policy.id,
      policyName: policy.name,
      ruleCount: 0,
      matchedRuleCount: 0,
      denyCount: deniedReasons.length,
      engine: 'aster-cnl',
      executionTime: apiResponse.executionTime,
      policyVersion: apiResponse.policyVersion,
    },
    result: apiResponse.result,
  };
}

/**
 * 构建 CNL 执行错误结果
 */
function buildCNLErrorResult(policy: Policy, error: unknown): PolicyExecutionResult {
  const errorMessage =
    error instanceof PolicyApiError
      ? `Policy evaluation failed: ${error.message}`
      : 'Failed to evaluate policy with Aster engine';

  console.error('[CNLExecutor] Aster API error:', error);

  return {
    allowed: false,
    approved: false,
    matchedRules: [],
    deniedReasons: [errorMessage],
    metadata: {
      evaluatedAt: new Date().toISOString(),
      policyId: policy.id,
      policyName: policy.name,
      ruleCount: 0,
      matchedRuleCount: 0,
      denyCount: 1,
      engine: 'aster-cnl',
      engineError: true,
    },
  };
}

/**
 * 获取执行结果的主要错误信息
 */
export function getPrimaryError(result: PolicyExecutionResult): string | undefined {
  return result.deniedReasons[0];
}

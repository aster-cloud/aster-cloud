/**
 * Aster CNL 策略执行服务
 *
 * 提供共享的 CNL 格式检测、语言识别和策略执行功能。
 * 供 Dashboard 和 API v1 两个执行端点复用。
 */

import { createPolicyApiClient, PolicyApiError, type PolicyEvaluateResponse } from './policy-api';
import { executePolicy as executeSimplePolicy } from './executor';
import type { Policy } from '@/lib/prisma';

// CNL locale type (simplified, no longer depends on local-compiler)
export type CNLLocale = 'en-US' | 'zh-CN' | 'de-DE';

// CNL 必须特征模式 - 这些是 CNL 独有的，简单 DSL 不具备
const CNL_REQUIRED_PATTERNS = [
  // 英文语法变体
  /This module is\s+\S+/im, // This module is finance.loan.
  /Define\s+\w+\s+with/im, // Define Applicant with
  /To\s+\w+.*produce\s+\w+/im, // To evaluateLoan with ... produce Text:
  /^\s*capability\s+\w+/m, // capability 声明
  /^\s*use\s+\w+/m, // use 导入
  // 中文方括号语法变体
  /【模块】/m, // 【模块】金融.贷款
  /【定义】/m, // 【定义】申请人 包含
  /【函数】\S+\s+包含.*产出/m, // 【函数】funcName 包含 params，产出：
  // 德语语法变体
  /Dieses Modul ist/im, // Dieses Modul ist finanz.kredit
  /Definiere\s+\w+\s+mit/im, // Definiere Antragsteller mit
  /Um\s+\w+\s+mit.*erzeuge/im, // Um kreditPruefen mit ... erzeuge
];

// 中文 CNL 关键字
const CHINESE_KEYWORDS = ['模块', '类型', '函数', '当', '则', '如果', '那么', '并且', '或者', '定义', '包含', '产出', '返回', '令', '为', '若'];

// 德语 CNL 关键字
const GERMAN_KEYWORDS = ['Modul', 'Definiere', 'Falls', 'Sonst', 'Gib zurück', 'erzeuge', 'größer als', 'kleiner als', 'Ganzzahl', 'Dezimal'];

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
 * 检测 CNL 语言类型（中文/英文/德文）
 */
export function detectCNLLocale(content: string): string {
  const hasChineseKeywords = CHINESE_KEYWORDS.some((keyword) => content.includes(keyword));
  if (hasChineseKeywords) {
    return 'zh-CN';
  }
  const hasGermanKeywords = GERMAN_KEYWORDS.some((keyword) => content.toLowerCase().includes(keyword.toLowerCase()));
  if (hasGermanKeywords) {
    return 'de-DE';
  }
  return 'en-US';
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
 *
 * 执行流程：远程 API 执行（实际策略评估）
 * 本地编译验证已移至 LSP（Language Server Protocol）
 */
async function executeWithAsterEngine(
  policy: Policy,
  policyContent: string,
  input: Record<string, unknown>,
  userId: string,
  tenantId?: string
): Promise<PolicyExecutionResult> {
  const locale = detectCNLLocale(policyContent) as CNLLocale;
  const effectiveTenantId = tenantId || policy.teamId || policy.userId;
  const apiClient = createPolicyApiClient(effectiveTenantId, userId);

  try {
    const response = await apiClient.evaluateSource(policyContent, input, { locale });
    return buildCNLResult(policy, response);
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
 * 从 CNL 结果中解析批准状态
 *
 * CNL 函数可能返回：
 * 1. 对象格式：{ approved: boolean, reason?: string }
 * 2. 字符串格式："批准，优惠利率" / "Approved with premium rate" / "Genehmigt..."
 *
 * 对于字符串格式，通过关键字匹配判断批准状态
 */
function parseApprovalFromResult(result: unknown): { approved: boolean; message: string } {
  // 对象格式：支持多语言字段名
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;

    // 支持的批准字段名（英/中/德）
    const approvalFields = ['approved', '批准', 'genehmigt'];
    // 支持的理由字段名（英/中/德）
    const reasonFields = ['reason', '理由', 'begruendung'];

    // 查找批准字段
    const approvalField = approvalFields.find(f => f in obj);
    if (approvalField) {
      const approved = obj[approvalField] === true;
      // 查找理由字段
      const reasonField = reasonFields.find(f => f in obj);
      const reason = reasonField ? String(obj[reasonField]) : (approved ? 'Approved' : 'Denied');
      return { approved, message: reason };
    }
  }

  // 字符串格式：通过关键字判断
  if (typeof result === 'string') {
    const resultStr = result.toLowerCase();
    // 批准关键字（中/英/德）
    const approvalKeywords = ['批准', 'approved', 'genehmigt', '通过', 'accept'];
    // 拒绝/待定关键字
    const denialKeywords = ['拒绝', 'denied', 'reject', 'abgelehnt', '需要人工', 'requires', 'manual', 'erfordert'];

    const isApproved = approvalKeywords.some((kw) => resultStr.includes(kw));
    const isDenied = denialKeywords.some((kw) => resultStr.includes(kw));

    // 如果同时包含批准和待定/拒绝关键字，以拒绝为准（保守原则）
    if (isApproved && !isDenied) {
      return { approved: true, message: result };
    }
    return { approved: false, message: result };
  }

  // 其他类型：无法解析，视为拒绝
  return { approved: false, message: 'Unknown result format' };
}

/**
 * 构建 CNL 执行结果
 *
 * 策略：
 * 1. 如果有 result，优先解析 result 判断批准状态
 * 2. 如果没有 result 且 success=false，返回错误
 * 3. 安全原则：fail-closed，无法解析时拒绝
 */
function buildCNLResult(policy: Policy, apiResponse: PolicyEvaluateResponse): PolicyExecutionResult {
  // 如果有 result，尝试解析（即使 success=false）
  // 某些情况下 API 可能返回 success=false 但仍有有效结果
  if (apiResponse.result !== undefined && apiResponse.result !== null) {
    const { approved, message } = parseApprovalFromResult(apiResponse.result);

    // 构建结果
    const deniedReasons: string[] = [];
    if (!approved) {
      deniedReasons.push(message);
    }

    return {
      allowed: approved,
      approved,
      matchedRules: approved ? [message] : [],
      deniedReasons,
      metadata: {
        evaluatedAt: new Date().toISOString(),
        policyId: policy.id,
        policyName: policy.name,
        ruleCount: 1,
        matchedRuleCount: approved ? 1 : 0,
        denyCount: approved ? 0 : 1,
        engine: 'aster-cnl',
        executionTime: apiResponse.executionTimeMs,
      },
      result: apiResponse.result,
    };
  }

  // 没有 result 且调用失败，返回错误
  return {
    allowed: false,
    approved: false,
    matchedRules: [],
    deniedReasons: [apiResponse.error || 'Policy evaluation failed: no result returned'],
    metadata: {
      evaluatedAt: new Date().toISOString(),
      policyId: policy.id,
      policyName: policy.name,
      ruleCount: 0,
      matchedRuleCount: 0,
      denyCount: 1,
      engine: 'aster-cnl',
      executionTime: apiResponse.executionTimeMs,
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

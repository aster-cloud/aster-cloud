// 统一升级触发器（v1.1 PM）
// 详见 aster-deploy/docs/pm/05-pricing-packaging.md F3 章节
//
// 设计要点：
//   - 所有 API 路由对外的"升级提示"都走这一个接口，避免 JSON 格式分散
//   - reason 取值与前端 UpgradeBlocker 的 i18n 键一一对齐
//   - audit_retention / sso / data_residency 推荐 enterprise，其余推荐 pro

export type UpgradeReason =
  | 'published_rules'
  | 'evaluations'
  | 'audit_retention'
  | 'sso'
  | 'data_residency'
  | 'reviewer_required'
  | 'team_member_invite';

export type RecommendedPlan = 'pro' | 'enterprise';

export interface UpgradeResponse {
  upgrade: true;
  reason: UpgradeReason;
  usage?: number;
  limit?: number;
  recommendedPlan: RecommendedPlan;
  /** 与现有 edit-policy-content.tsx 的兼容字段 */
  message: string;
}

const ENTERPRISE_REASONS: ReadonlySet<UpgradeReason> = new Set([
  'audit_retention',
  'sso',
  'data_residency',
]);

/**
 * 构造统一升级响应体
 */
export function upgradeResponse(
  reason: UpgradeReason,
  options: { usage?: number; limit?: number; message?: string } = {}
): UpgradeResponse {
  const recommendedPlan: RecommendedPlan = ENTERPRISE_REASONS.has(reason) ? 'enterprise' : 'pro';
  const message = options.message ?? `upgrade required: ${reason}`;
  return {
    upgrade: true,
    reason,
    usage: options.usage,
    limit: options.limit,
    recommendedPlan,
    message,
  };
}

/**
 * 标准 HTTP 状态码：402 Payment Required（与 aster-api PlanLimitException 对齐）
 */
export const UPGRADE_HTTP_STATUS = 402;

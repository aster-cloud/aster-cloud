/**
 * 注册时风险分层（5 级）。在 createUser 中根据多个信号一次性评估并冻结到
 * User.riskTier，下游决策（trial 起点、AI 配额、API 配额、Stripe）读该字段
 * 分流，不再重新评估。
 *
 * 设计原则：
 *  - 不直接拒绝注册：让用户进来，但限制其能造成的损害
 *  - 决策可解释：触发的关键信号写入 riskTierReason
 *  - 留人工申诉路径：admin tool 可手动降级
 *  - 信号叠加：单一信号不足以触发高 tier，多信号同时命中才升级
 *
 * 详见 docs/risk-tier-design.md。
 */

import { and, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '@/db';
import { users } from '@/db/schema';

export type RiskTier = 0 | 1 | 2 | 3 | 4;

export interface RiskAssessment {
  tier: RiskTier;
  reason: string;
  signals: Record<string, number | boolean>;
}

export interface AssessmentInputs {
  priorPurgeCount: number;
  signupIpHash: string | null;
  emailNormalized: string | null;
}

/** 24h 内同 signupIpHash 注册的账号数（含本次新建之前的）。 */
async function countIpClusterPeers(db: Database, ipHash: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.signupIpHash, ipHash), gte(users.createdAt, since), isNotNull(users.id)));
  return rows[0]?.c ?? 0;
}

/**
 * 评估一个新用户的风险层。
 *
 * tier 阶梯：
 *   0 trusted   priorPurge=0 且 ipCluster<3
 *   1 normal    priorPurge=1 或 ipCluster=3
 *   2 elevated  priorPurge=2 或 ipCluster≥4
 *   3 high      priorPurge=3
 *   4 hard      priorPurge≥4
 *
 * 同时命中多个 tier 时取较高者。
 */
export async function assessRegistrationRisk(
  db: Database,
  inputs: AssessmentInputs,
): Promise<RiskAssessment> {
  const signals: Record<string, number | boolean> = {
    prior_purge: inputs.priorPurgeCount,
  };

  let ipCluster = 0;
  if (inputs.signupIpHash) {
    ipCluster = await countIpClusterPeers(db, inputs.signupIpHash);
    signals.ip_cluster = ipCluster;
  }

  // 单信号映射
  const fromPurge =
    inputs.priorPurgeCount >= 4 ? 4
    : inputs.priorPurgeCount === 3 ? 3
    : inputs.priorPurgeCount === 2 ? 2
    : inputs.priorPurgeCount === 1 ? 1
    : 0;

  const fromIp =
    ipCluster >= 4 ? 2
    : ipCluster === 3 ? 1
    : 0;

  const tier = Math.max(fromPurge, fromIp) as RiskTier;

  // 原因串：只列触发非零分量的信号
  const reasonParts: string[] = [];
  if (fromPurge > 0) reasonParts.push(`prior_purge=${inputs.priorPurgeCount}`);
  if (fromIp > 0) reasonParts.push(`ip_cluster=${ipCluster}`);
  const reason = reasonParts.length === 0 ? 'trusted' : reasonParts.join(',');

  return { tier, reason, signals };
}

// ──────────────────────────────────────────────────────────────────
// 决策表（下游模块共用，避免散落 if 链）
// ──────────────────────────────────────────────────────────────────

export interface TierPolicy {
  /** trial 天数；0 表示无 trial（直接 free 计划）。 */
  trialDays: number;
  /** AI 月配额乘子（1 = 默认；0 = 完全禁用）。 */
  aiQuotaMultiplier: number;
  /** API 月配额乘子。 */
  apiQuotaMultiplier: number;
  /** Stripe checkout 是否允许（false = 高 tier 用户不能升级到付费，需联系 support）。 */
  allowStripeCheckout: boolean;
  /** 是否要求 email-verified 才能调 API（防一次性邮箱注册立刻盗刷）。 */
  requireEmailVerifiedForApi: boolean;
  /** 风险层 audit log 是否需要立即告警 Slack。 */
  alertOnRegistration: boolean;
}

export function policyForTier(tier: RiskTier): TierPolicy {
  switch (tier) {
    case 0:
      return {
        trialDays: 14,
        aiQuotaMultiplier: 1,
        apiQuotaMultiplier: 1,
        allowStripeCheckout: true,
        requireEmailVerifiedForApi: false,
        alertOnRegistration: false,
      };
    case 1:
      return {
        trialDays: 7,
        aiQuotaMultiplier: 0.5,
        apiQuotaMultiplier: 1,
        allowStripeCheckout: true,
        requireEmailVerifiedForApi: false,
        alertOnRegistration: false,
      };
    case 2:
      return {
        trialDays: 0,
        aiQuotaMultiplier: 0.25,
        apiQuotaMultiplier: 0.5,
        allowStripeCheckout: true,
        requireEmailVerifiedForApi: true,
        alertOnRegistration: true,
      };
    case 3:
      return {
        trialDays: 0,
        aiQuotaMultiplier: 0,
        apiQuotaMultiplier: 0.25,
        allowStripeCheckout: false,
        requireEmailVerifiedForApi: true,
        alertOnRegistration: true,
      };
    case 4:
      return {
        trialDays: 0,
        aiQuotaMultiplier: 0,
        apiQuotaMultiplier: 0,
        allowStripeCheckout: false,
        requireEmailVerifiedForApi: true,
        alertOnRegistration: true,
      };
  }
}

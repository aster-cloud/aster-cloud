// AI 配额计算 + 异常检测
// 详见 aster-deploy/docs/pm/07-ai-billing.md

import { db, users, aiUsageRecords, aiKeyBindings } from '@/lib/prisma';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getEffectiveLimits, type PlanType } from '@/lib/plans';
import { encryptForAudit } from '@/lib/ai-audit-vault';
import { redactPii } from '@/lib/ai-pii-redactor';

// ============================================================================
// 月度配额（次数）
// ============================================================================

/** Free 月配额（PM 文档 07-ai-billing.md）*/
export const AI_MONTHLY_QUOTA = {
  free: 20,
  trial: 100,
  pro: 500,        // 每席位
  team: 500,
  enterprise: -1,  // 无限
} as const;

/** 速率限制（每分钟）*/
export const AI_RATE_LIMIT_PER_MINUTE = {
  free: 5,
  trial: 15,
  pro: 30,
  team: 30,
  enterprise: 200,
} as const;

/** 速率限制（每小时） */
export const AI_RATE_LIMIT_PER_HOUR = {
  free: 20,
  trial: 80,
  pro: 200,
  team: 200,
  enterprise: 1000,
} as const;

export type AiQuotaResult =
  | { allowed: true; remaining: number; limit: number; usedByok: boolean }
  | {
      allowed: false;
      reason: 'ai_quota_exhausted' | 'ai_rate_limited' | 'ai_banned' | 'ai_email_unverified';
      message: string;
      retryAfterSec?: number;
    };

/**
 * 检查用户当前是否可调 AI
 *
 * 顺序：
 *   1. 用户是否有有效 BYOK → 直接放行（不计平台配额）
 *   2. 用户是否被自动封禁
 *   3. 月度次数配额
 *   4. 每分钟速率
 *   5. 每小时速率
 */
export async function checkAiQuota(userId: string): Promise<AiQuotaResult> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      plan: true,
      priceLockedAt: true,
      legacyTier: true,
      aiBannedUntil: true,
      aiBanReason: true,
      emailVerified: true,
      riskTier: true,
    },
  });
  if (!user) {
    return { allowed: false, reason: 'ai_quota_exhausted', message: 'user not found' };
  }

  // 注册风险层 → 配额乘子 + email-verified 硬要求
  const { policyForTier } = await import('@/lib/risk-tier');
  const tier = (user.riskTier ?? 0) as 0 | 1 | 2 | 3 | 4;
  const riskPolicy = policyForTier(tier);

  // tier 4 + tier 3 完全禁用 AI
  if (riskPolicy.aiQuotaMultiplier === 0) {
    return {
      allowed: false,
      reason: 'ai_banned',
      message: `AI 功能因账户风险等级被禁用（tier ${tier}）。如需启用请联系 support@aster-lang.cloud。`,
    };
  }

  // tier ≥ 2 强制 email-verified（不再走 plan 分支，所有 plan 都要求）
  if (riskPolicy.requireEmailVerifiedForApi && !user.emailVerified) {
    return {
      allowed: false,
      reason: 'ai_email_unverified',
      message: '账户处于审查状态，请先完成邮箱验证以解锁 AI 功能。验证邮件已发送至您注册邮箱。',
    };
  }

  // L0: BYOK 优先 — 用户绑定了自己 key 直接放行
  const byok = await db.query.aiKeyBindings.findFirst({
    where: and(eq(aiKeyBindings.userId, userId), eq(aiKeyBindings.active, true)),
    columns: { id: true, provider: true },
  });
  if (byok) {
    return { allowed: true, remaining: -1, limit: -1, usedByok: true };
  }

  // L0.5: Free 档强制邮箱验证才解锁配额（trial / pro / team / enterprise 不受影响）
  // 详见 07-ai-billing.md "反多重注册"
  if (user.plan === 'free' && !user.emailVerified) {
    return {
      allowed: false,
      reason: 'ai_email_unverified',
      message: '请先完成邮箱验证以解锁 AI 功能。验证邮件已发送至您注册邮箱。',
    };
  }

  // L1: 自动封禁
  if (user.aiBannedUntil && user.aiBannedUntil > new Date()) {
    const sec = Math.ceil((user.aiBannedUntil.getTime() - Date.now()) / 1000);
    return {
      allowed: false,
      reason: 'ai_banned',
      message: user.aiBanReason || '账号被临时禁用 AI 功能',
      retryAfterSec: sec,
    };
  }

  const plan = user.plan as PlanType;

  // L2: 月度次数配额（base × riskTier 乘子；tier 0 trusted = ×1，tier 1 = ×0.5 …）
  const baseLimit = AI_MONTHLY_QUOTA[plan as keyof typeof AI_MONTHLY_QUOTA] ?? 20;
  const monthlyLimit = baseLimit === -1
    ? -1
    : Math.max(1, Math.floor(baseLimit * riskPolicy.aiQuotaMultiplier));
  if (monthlyLimit !== -1) {
    const period = currentPeriod();
    const monthlyCount = await countSuccessfulCalls(userId, period);
    if (monthlyCount >= monthlyLimit) {
      return {
        allowed: false,
        reason: 'ai_quota_exhausted',
        message: tier > 0
          ? `本月 AI 配额已用尽（${monthlyCount} / ${monthlyLimit}，账户风险等级 ${tier} 影响配额）。绑定自己的 OpenAI key 或联系 support。`
          : `本月 AI 配额已用尽（${monthlyCount} / ${monthlyLimit}）。绑定自己的 OpenAI key 或升级套餐。`,
      };
    }
  }

  // L3: 每分钟速率
  const perMinuteLimit = AI_RATE_LIMIT_PER_MINUTE[plan as keyof typeof AI_RATE_LIMIT_PER_MINUTE] ?? 5;
  const lastMinute = await countCallsSince(userId, new Date(Date.now() - 60_000));
  if (lastMinute >= perMinuteLimit) {
    return {
      allowed: false,
      reason: 'ai_rate_limited',
      message: `请求太频繁（${lastMinute}/${perMinuteLimit} 每分钟）`,
      retryAfterSec: 60,
    };
  }

  // L4: 每小时速率
  const perHourLimit = AI_RATE_LIMIT_PER_HOUR[plan as keyof typeof AI_RATE_LIMIT_PER_HOUR] ?? 20;
  const lastHour = await countCallsSince(userId, new Date(Date.now() - 3_600_000));
  if (lastHour >= perHourLimit) {
    return {
      allowed: false,
      reason: 'ai_rate_limited',
      message: `1 小时内请求达到上限（${lastHour}/${perHourLimit}）`,
      retryAfterSec: 3600,
    };
  }

  // 计算剩余
  void getEffectiveLimits; // 保留 import，未来扩展用
  const period = currentPeriod();
  const monthlyCount = await countSuccessfulCalls(userId, period);
  return {
    allowed: true,
    remaining: monthlyLimit === -1 ? -1 : Math.max(0, monthlyLimit - monthlyCount),
    limit: monthlyLimit,
    usedByok: false,
  };
}

/**
 * 调用完成后记录用量（异步、不阻塞业务路径）
 */
export async function recordAiUsage(params: {
  userId: string;
  teamId?: string | null;
  callKind: 'generate' | 'explain' | 'suggest' | 'complete' | 'repair';
  model: string;
  promptTokens: number;
  completionTokens: number;
  usedByok: boolean;
  status: 'success' | 'quota_exhausted' | 'rate_limited' | 'banned' | 'api_error' | 'blocked_unsafe';
  promptHash?: string | null;
  /** 调用审计：原始 prompt / completion，会被加密存 180 天 */
  prompt?: string | null;
  completion?: string | null;
  /** PII 脱敏后的 prompt 明文（永久保留） */
  redactedPrompt?: string | null;
  /** 内容安全标记（jailbreak / pii / toxic / blocked_reason） */
  safetyFlags?: {
    jailbreak_attempt?: boolean;
    pii_detected?: boolean;
    toxic?: boolean;
    blocked_reason?: string;
  } | null;
}): Promise<void> {
  const cost = estimateCostCents(params.model, params.promptTokens, params.completionTokens);
  await db.insert(aiUsageRecords).values({
    id: globalThis.crypto.randomUUID(),
    userId: params.userId,
    teamId: params.teamId ?? null,
    periodMonth: currentPeriod(),
    callKind: params.callKind,
    model: params.model,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    costCents: cost,
    usedByok: params.usedByok,
    status: params.status,
    promptHash: params.promptHash ?? null,
    encryptedPrompt: encryptForAudit(params.prompt) as unknown as string | null,
    encryptedCompletion: encryptForAudit(params.completion) as unknown as string | null,
    // 调用方未显式传 redactedPrompt 时自动从 prompt 脱敏生成
    redactedPrompt:
      params.redactedPrompt ?? (params.prompt ? redactPii(params.prompt) : null),
    safetyFlags: params.safetyFlags ?? null,
    createdAt: new Date(),
  });
}

// ============================================================================
// 内部辅助
// ============================================================================

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function countSuccessfulCalls(userId: string, periodMonth: string): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(aiUsageRecords)
    .where(
      and(
        eq(aiUsageRecords.userId, userId),
        eq(aiUsageRecords.periodMonth, periodMonth),
        eq(aiUsageRecords.usedByok, false),
        eq(aiUsageRecords.status, 'success')
      )
    );
  return r[0]?.c ?? 0;
}

async function countCallsSince(userId: string, since: Date): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(aiUsageRecords)
    .where(and(eq(aiUsageRecords.userId, userId), gte(aiUsageRecords.createdAt, since)));
  return r[0]?.c ?? 0;
}

/**
 * 估算成本（美分），按 OpenAI 公开价格
 * 默认 gpt-4o-mini；其他模型回退到 gpt-4o-mini 价位（保守）
 */
function estimateCostCents(model: string, promptTokens: number, completionTokens: number): number {
  // 价格表（USD per 1M tokens）
  const pricing: Record<string, { prompt: number; completion: number }> = {
    'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
    'gpt-4o': { prompt: 2.5, completion: 10 },
    'gpt-4': { prompt: 30, completion: 60 },
    'claude-3-5-sonnet': { prompt: 3, completion: 15 },
    'claude-3-haiku': { prompt: 0.25, completion: 1.25 },
  };
  const p = pricing[model] || pricing['gpt-4o-mini'];
  const usd = (promptTokens / 1_000_000) * p.prompt + (completionTokens / 1_000_000) * p.completion;
  return Math.ceil(usd * 100); // 向上取整美分
}

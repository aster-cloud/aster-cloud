// 启动期 env 校验（fail-fast）
//
// 设计意图：
//   - production 启动时缺关键 env → 立即 throw，避免上线后业务路径才发现
//   - development 仅 warn，让本地开发不被打断
//   - test 完全跳过（避免 contract test / unit test 自构造 env 误触发）
//
// 触发点：next.config.ts 顶层调用 validateEnvOrWarn()
//
// 详见：aster-deploy/docs/pm/05-pricing-packaging.md / 03-telemetry-spec.md

type EnvCheck = {
  key: string;
  required: 'always' | 'production-only';
  description: string;
};

/**
 * 关键 env 清单
 *
 * 把"必须配的 env"放进代码，新增 SKU/feature 时强制更新此清单（contract）。
 */
const ENV_CHECKS: readonly EnvCheck[] = [
  // 数据库
  { key: 'DATABASE_URL', required: 'always', description: 'Drizzle / Postgres 连接串' },

  // Auth
  { key: 'AUTH_SECRET', required: 'production-only', description: 'NextAuth 加密密钥' },

  // Stripe（PM v1.1 三档定价）
  { key: 'STRIPE_SECRET_KEY', required: 'production-only', description: 'Stripe API 密钥' },
  { key: 'STRIPE_WEBHOOK_SECRET', required: 'production-only', description: 'Stripe webhook 验签' },

  // Pro 三货币 × 月/年 = 6 个 priceId（生产必须配齐）
  // 详见 aster-deploy/docs/pm/05-pricing-packaging.md F2
  { key: 'NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID', required: 'production-only', description: 'Pro USD 月付' },
  { key: 'NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID', required: 'production-only', description: 'Pro USD 年付' },
  { key: 'NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID', required: 'production-only', description: 'Pro CNY 月付' },
  { key: 'NEXT_PUBLIC_STRIPE_PRO_YEARLY_CNY_PRICE_ID', required: 'production-only', description: 'Pro CNY 年付' },

  // NSM 埋点（前端）
  { key: 'NEXT_PUBLIC_MIXPANEL_TOKEN', required: 'production-only', description: 'Mixpanel project token' },

  // 跨服务 PlanGate（aster-cloud 内部接口被 aster-api 调用）
  { key: 'ASTER_PLAN_GATE_HMAC_KEY', required: 'production-only', description: 'PlanGate HMAC 共享密钥' },

  // R21-Critical-2: cron 鉴权密钥（生产必填，否则 requireCronAuth 返回 503）
  { key: 'CRON_SECRET', required: 'production-only', description: 'Cloudflare/Vercel cron trigger 鉴权密钥；缺失时所有 cron route 返回 503' },

  // 邮件（F2.5 trial reminder + 失败通知）
  { key: 'RESEND_API_KEY', required: 'production-only', description: 'Resend 邮件服务' },

  // App URL（webhook redirect / mail link）
  { key: 'NEXT_PUBLIC_APP_URL', required: 'production-only', description: '部署 URL（webhook redirect / 邮件 CTA）' },
] as const;

export interface ValidationResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * 校验当前 env，返回结果（不抛）
 *
 * 用于测试 / 不希望硬终止的场景。
 */
export function checkEnv(env: NodeJS.ProcessEnv = process.env): ValidationResult {
  const isProduction = env.NODE_ENV === 'production';
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const check of ENV_CHECKS) {
    const value = env[check.key];
    const isMissing = !value || value.trim() === '';
    if (!isMissing) continue;

    const friendlyMsg = `${check.key} (${check.description})`;
    if (check.required === 'always') {
      missing.push(friendlyMsg);
    } else if (check.required === 'production-only') {
      if (isProduction) {
        missing.push(friendlyMsg);
      } else {
        warnings.push(friendlyMsg);
      }
    }
  }

  return { ok: missing.length === 0, missing, warnings };
}

/**
 * 启动期 fail-fast：production 缺 env 直接抛
 *
 * - production：missing 任何 always/production-only → throw
 * - development：missing always → throw；缺 production-only → warn
 * - test：完全跳过（避免污染单元测试的自构造 env）
 */
export function validateEnvOrThrow(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'test' || env.VITEST === 'true') return;

  const result = checkEnv(env);
  if (!result.ok) {
    const lines = ['[env-validation] 缺失关键环境变量：'];
    for (const m of result.missing) lines.push(`  - ${m}`);
    lines.push('');
    lines.push('详见 src/lib/env-validation.ts 中的 ENV_CHECKS 清单');
    throw new Error(lines.join('\n'));
  }
  if (result.warnings.length > 0 && env.NODE_ENV !== 'production') {
    console.warn('[env-validation] dev 模式下以下 env 未配（生产必须配齐）：');
    for (const w of result.warnings) console.warn(`  - ${w}`);
  }
}

/**
 * 仅 warn 不 throw 版本，用于 next.config 等不能阻塞编译的场景
 */
export function validateEnvOrWarn(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'test' || env.VITEST === 'true') return;
  if (env.NEXT_PHASE === 'phase-production-build') {
    // 构建阶段（next build）部分 runtime env 还未注入，跳过 production-only 校验
    return;
  }

  const result = checkEnv(env);
  if (!result.ok) {
    console.error('[env-validation] 缺失关键环境变量（runtime 启动将失败）：');
    for (const m of result.missing) console.error(`  - ${m}`);
  }
  if (result.warnings.length > 0) {
    console.warn('[env-validation] 以下 env 未配（生产必须配齐）：');
    for (const w of result.warnings) console.warn(`  - ${w}`);
  }
}

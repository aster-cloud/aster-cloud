-- v1.1 PM 重构：分离档位与组织实体
-- 详见 aster-deploy/docs/pm/05-pricing-packaging.md
--
-- 本迁移做两件事：
--   1. 给 users 表加 priceLockedAt / legacyTier / trialEndingEmailSentAt 三个字段
--   2. grandfather 现存 Team 用户：plan='team' 改 plan='pro' + legacyTier='team' + priceLockedAt=NOW()
--      老 Team 客户在 UI 上显示 Pro，价格 feature 不变（webhook 拿到 team priceId 时也走同样逻辑）
--
-- 用法：drizzle-kit generate 后会自动包含 schema 改动；手工 grandfather 步骤也写在这份 SQL 里以保证幂等

-- 1. 加字段
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "priceLockedAt" timestamp,
    ADD COLUMN IF NOT EXISTS "legacyTier" text,
    ADD COLUMN IF NOT EXISTS "trialEndingEmailSentAt" timestamp;

COMMENT ON COLUMN "User"."priceLockedAt" IS
    '首次锁定价格的时间。决定走 LEGACY_PLAN_LIMITS（老用户保护）还是 PM_PLAN_LIMITS_V2（新签）';
COMMENT ON COLUMN "User"."legacyTier" IS
    '遗留档位标记。plan=pro + legacyTier=team 表示从 Team 档 grandfather 而来的客户';
COMMENT ON COLUMN "User"."trialEndingEmailSentAt" IS
    'F2.5 trial 邮件发送幂等标记，避免 Stripe webhook 重投导致重复发邮件';

-- 2. grandfather 现存 Team 客户到 Pro
-- 用 CASE 保证幂等：已经被 grandfather 过的不会再动
UPDATE "User"
SET
    "legacyTier" = 'team',
    "priceLockedAt" = COALESCE("priceLockedAt", NOW()),
    "plan" = 'pro'
WHERE
    "plan" = 'team'
    AND "legacyTier" IS NULL;

-- 3. 给现存付费用户写入 priceLockedAt（基于订阅创建时间或 createdAt 兜底）
-- 这一步保护他们的限额，让其继续走 LEGACY_PLAN_LIMITS
UPDATE "User"
SET "priceLockedAt" = COALESCE("priceLockedAt", "createdAt")
WHERE
    "plan" IN ('pro', 'enterprise', 'trial')
    AND "stripeCustomerId" IS NOT NULL
    AND "priceLockedAt" IS NULL;

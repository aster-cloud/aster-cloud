-- ============================================================================
-- 0007: 修复 schema drift —— ApiCallRecord 表 + AiUsageRecord 审计列
-- ============================================================================
--
-- 背景：
--   - src/db/schema.ts 声明了 `apiCallRecords` (table "ApiCallRecord")，
--     但没有任何 migration 创建它 → /api/user/api-usage 在生产返回 500
--     (relation "ApiCallRecord" does not exist)。
--   - src/db/schema.ts 在 `aiUsageRecords` 里声明了四个审计列
--     (encryptedPrompt / encryptedCompletion / redactedPrompt / safetyFlags)，
--     但 0002_ai_billing.sql 只建了基础列 → /api/user/ai-usage 当 LLM 写记录
--     时报 "column does not exist"，最终也是 500。
--
-- 此 migration 仅补漏，幂等：使用 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS，
-- 不影响已写入的数据。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) ApiCallRecord —— 用户 Policy 执行调用的明细记录
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ApiCallRecord" (
    "id" text PRIMARY KEY NOT NULL,
    "userId" text NOT NULL,
    "tenantId" text,
    "apiKeyId" text,
    "periodMonth" text NOT NULL,
    "endpointPath" text NOT NULL,
    "status" text NOT NULL,
    "latencyMs" integer NOT NULL DEFAULT 0,
    "createdAt" timestamp NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ApiCall_userId_period_idx"
    ON "ApiCallRecord" ("userId", "periodMonth");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApiCall_tenantId_createdAt_idx"
    ON "ApiCallRecord" ("tenantId", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApiCall_apiKeyId_createdAt_idx"
    ON "ApiCallRecord" ("apiKeyId", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ApiCall_createdAt_retention_idx"
    ON "ApiCallRecord" ("createdAt");
--> statement-breakpoint

COMMENT ON TABLE "ApiCallRecord" IS
    '用户 Policy 执行 API 调用明细。与 AiUsageRecord（LLM 调用）不同，这里记的是 evaluate 系列端点。';
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2) AiUsageRecord —— 补齐审计/合规列
-- ----------------------------------------------------------------------------
ALTER TABLE "AiUsageRecord"
    ADD COLUMN IF NOT EXISTS "encryptedPrompt" text,
    ADD COLUMN IF NOT EXISTS "encryptedCompletion" text,
    ADD COLUMN IF NOT EXISTS "redactedPrompt" text,
    ADD COLUMN IF NOT EXISTS "safetyFlags" json;
--> statement-breakpoint

COMMENT ON COLUMN "AiUsageRecord"."encryptedPrompt" IS
    'pgp_sym_encrypt 加密后的原始 prompt。保留期 180 天，cron 删除';
--> statement-breakpoint
COMMENT ON COLUMN "AiUsageRecord"."encryptedCompletion" IS
    'pgp_sym_encrypt 加密后的 LLM 输出。保留期 180 天';
--> statement-breakpoint
COMMENT ON COLUMN "AiUsageRecord"."redactedPrompt" IS
    'PII 脱敏后的 prompt 明文（邮箱/手机/卡号 → [REDACTED:TYPE]）。永久保留：合规 + 异常检测训练样本';
--> statement-breakpoint
COMMENT ON COLUMN "AiUsageRecord"."safetyFlags" IS
    '内容安全标记 JSON：{ jailbreak_attempt, pii_detected, toxic, blocked_reason }。永久保留';
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3) 补齐 AiUsage 索引（schema.ts 声明的，但 0002 没建）
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "AiUsage_userId_period_idx"
    ON "AiUsageRecord" ("userId", "periodMonth");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiUsage_userId_createdAt_idx"
    ON "AiUsageRecord" ("userId", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiUsage_teamId_period_idx"
    ON "AiUsageRecord" ("teamId", "periodMonth");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiUsage_promptHash_idx"
    ON "AiUsageRecord" ("promptHash", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiUsage_createdAt_retention_idx"
    ON "AiUsageRecord" ("createdAt");

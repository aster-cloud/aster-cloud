-- v1.0 AI 计费 + 防盗刷
-- 详见 aster-deploy/docs/pm/07-ai-billing.md

-- 1. users 表加自动封禁字段
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "aiBannedUntil" timestamp,
    ADD COLUMN IF NOT EXISTS "aiBanReason" text;

COMMENT ON COLUMN "User"."aiBannedUntil" IS
    '防盗刷自动封禁解禁时间。NULL 表示未封禁；NOW() < value 时禁用 AI 调用';

-- 2. AI 调用记录（细粒度 token）
CREATE TABLE IF NOT EXISTS "AiUsageRecord" (
    "id" text PRIMARY KEY NOT NULL,
    "userId" text NOT NULL,
    "teamId" text,
    "periodMonth" text NOT NULL,
    "callKind" text NOT NULL,
    "model" text NOT NULL,
    "promptTokens" integer NOT NULL DEFAULT 0,
    "completionTokens" integer NOT NULL DEFAULT 0,
    "costCents" integer NOT NULL DEFAULT 0,
    "usedByok" boolean NOT NULL DEFAULT false,
    "status" text NOT NULL,
    "promptHash" text,
    "createdAt" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "AiUsage_userId_period_idx"     ON "AiUsageRecord" ("userId", "periodMonth");
CREATE INDEX IF NOT EXISTS "AiUsage_userId_createdAt_idx"  ON "AiUsageRecord" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsage_teamId_period_idx"     ON "AiUsageRecord" ("teamId", "periodMonth");
CREATE INDEX IF NOT EXISTS "AiUsage_promptHash_idx"        ON "AiUsageRecord" ("promptHash", "userId");

COMMENT ON TABLE "AiUsageRecord" IS
    'AI 调用细粒度记录，月度配额计算与异常检测的数据源（仅 token 数 + 成本，不存 prompt 内容）';

-- 3. 用户 BYOK key 绑定
CREATE TABLE IF NOT EXISTS "AiKeyBinding" (
    "id" text PRIMARY KEY NOT NULL,
    "userId" text NOT NULL,
    "provider" text NOT NULL,
    "encryptedKey" text NOT NULL,
    "keyHint" text NOT NULL,
    "active" boolean NOT NULL DEFAULT true,
    "lastUsedAt" timestamp,
    "lastErrorAt" timestamp,
    "lastError" text,
    "createdAt" timestamp NOT NULL DEFAULT NOW(),
    "updatedAt" timestamp NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiKey_userId_provider_idx" ON "AiKeyBinding" ("userId", "provider");
CREATE INDEX IF NOT EXISTS "AiKey_active_idx"                 ON "AiKeyBinding" ("active");

COMMENT ON TABLE "AiKeyBinding" IS
    'BYOK key 绑定。encryptedKey 用 pgcrypto pgp_sym_encrypt 加密，密钥来自 AI_KEY_ENCRYPTION_SECRET';

-- 4. 启用 pgcrypto（用于 BYOK key 加密）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

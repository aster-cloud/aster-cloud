-- Registration-time risk tier classification
--
-- riskTier 0..4，越高限制越严。在 createUser 时由 lib/risk-tier.ts 计算后冻结。
-- 决策点（trial、AI quota、API quota、Stripe）读该字段分流，不每次重算。
--
-- riskTierReason: 触发该 tier 的关键信号集合（"prior_purge=3,ip_cluster=4"），
-- 写入 audit log + 客户支持页面展示，便于人工申诉。
--
-- 幂等。

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "riskTier" integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "riskTierReason" text;

-- 反盗刷查询：列出所有非 trusted 用户
CREATE INDEX IF NOT EXISTS "User_riskTier_idx"
    ON "User" ("riskTier")
    WHERE "riskTier" > 0;

-- Renewal token table (SaaS-only, drives self-serve renewal portal entry).
--
-- Each row represents one short-lived (14d) URL-safe handle emailed to the
-- license operator when expiry approaches. Plaintext token never leaves the
-- mint site; we store only sha256(token) and gate the portal on hash match
-- + expiresAt + consumedAt.
--
-- Lifecycle:
--   created → emailSentAt set → consumedAt set when ops clicks through
--   to Stripe → row may be reused for retry until expiresAt.
--
-- Why hash-only:
--   If the SaaS DB is compromised the attacker still cannot derive a valid
--   renewal URL. Treats the row as a verifier, not a secret store.

CREATE TABLE IF NOT EXISTS "RenewalToken" (
  "token_hash" text PRIMARY KEY,
  "license_id" text NOT NULL,
  "customer" text NOT NULL,
  "old_deployment_binding" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "email_sent_at" timestamptz,
  "consumed_at" timestamptz
);

-- 同一张 license 在 30/14/7/1 天阈值会重复发 token；查询时按 expiresAt 取最新的。
CREATE INDEX IF NOT EXISTS "RenewalToken_license_expires_idx"
  ON "RenewalToken" ("license_id", "expires_at" DESC);

-- 清理过期 token（cron 调用），按 expiresAt 反向扫。
CREATE INDEX IF NOT EXISTS "RenewalToken_expires_idx"
  ON "RenewalToken" ("expires_at");

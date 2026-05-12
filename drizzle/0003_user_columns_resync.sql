-- Phase 3 user-columns catch-up migration
--
-- Production DB drifted behind src/db/schema.ts. Auth.js v5 callback
-- queries SELECT all User columns and Postgres rejects (42703 undefined column)
-- → AdapterError → /login?error=Configuration on every signin.
--
-- Idempotent — uses ADD COLUMN IF NOT EXISTS.
--
-- Bundles fields accumulated across:
--   - emailNormalized + index (anti-multi-registration dedup)
--   - signupIpHash (GDPR-safe registration cluster detection)
--   - AI 防盗刷 / quota warnings (07-ai-billing.md)
--   - Dunning grace period (Stripe webhook handlers)

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "emailNormalized" text,
    ADD COLUMN IF NOT EXISTS "signupIpHash" text,
    ADD COLUMN IF NOT EXISTS "apiQuotaWarn80SentAt" timestamp,
    ADD COLUMN IF NOT EXISTS "apiQuotaWarn100SentAt" timestamp,
    ADD COLUMN IF NOT EXISTS "apiQuotaWarn200SentAt" timestamp,
    ADD COLUMN IF NOT EXISTS "gracePeriodStartsAt" timestamp,
    ADD COLUMN IF NOT EXISTS "gracePeriodEndsAt" timestamp,
    ADD COLUMN IF NOT EXISTS "dunningEmailsSentCount" integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lastDunningEmailSentAt" timestamp,
    ADD COLUMN IF NOT EXISTS "downgradedAt" timestamp;

-- Backfill emailNormalized for existing rows
-- (mirror of lib/email-normalize.ts — gmail+xxx strip + dots removed + lowercase)
UPDATE "User"
SET "emailNormalized" = LOWER(
    CASE
        -- gmail: strip dots in local part + drop +xxx alias
        WHEN email LIKE '%@gmail.com' THEN
            REGEXP_REPLACE(SPLIT_PART(SPLIT_PART(email, '@', 1), '+', 1), '\.', '', 'g')
            || '@gmail.com'
        -- googlemail.com aliases gmail.com
        WHEN email LIKE '%@googlemail.com' THEN
            REGEXP_REPLACE(SPLIT_PART(SPLIT_PART(email, '@', 1), '+', 1), '\.', '', 'g')
            || '@gmail.com'
        -- generic: drop +xxx alias only
        ELSE
            SPLIT_PART(SPLIT_PART(email, '@', 1), '+', 1) || '@' || SPLIT_PART(email, '@', 2)
    END
)
WHERE email IS NOT NULL AND "emailNormalized" IS NULL;

-- Unique index — fails if backfill produces collisions; that means real
-- duplicate accounts exist and need manual reconciliation before this
-- migration can complete.
CREATE UNIQUE INDEX IF NOT EXISTS "User_emailNormalized_unique"
    ON "User" ("emailNormalized")
    WHERE "emailNormalized" IS NOT NULL;

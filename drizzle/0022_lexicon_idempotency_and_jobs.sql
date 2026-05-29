-- User-managed Domain Vocabularies (B5).
--
-- Adds the production support tables for mutation idempotency and bulk import
-- job tracking:
--   - LexiconIdempotencyKey stores a 24h replay window keyed by
--     (userId, routeKey, idempotencyKey). requestHash protects against a
--     client reusing a key with a different payload.
--   - LexiconBulkJob records both sync and async bulk imports. Sync jobs
--     insert completed rows for auditability; async jobs are claimed by the
--     bulk worker via the (status, createdAt) index and progress through
--     queued -> running -> completed | failed | cancelled.
--
-- Concurrency note: drizzle-kit migrations in this repo are journaled with
-- per-file breakpoints (see drizzle/meta/_journal.json) and execute inside a
-- single transaction per file. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction, so it is not used here. Both tables are brand-new and empty
-- at apply time, making non-concurrent index creation safe and fast.

CREATE TABLE IF NOT EXISTS "LexiconIdempotencyKey" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "idempotencyKey" text NOT NULL,
  "routeKey" text NOT NULL,
  "requestHash" text NOT NULL,
  "responseStatus" integer NOT NULL,
  "responseBody" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  CONSTRAINT "LexiconIdempotencyKey_userId_User_id_fk"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "LexiconIdempotencyKey_user_route_key_unique"
  ON "LexiconIdempotencyKey" ("userId", "routeKey", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "LexiconIdempotencyKey_expiresAt_idx"
  ON "LexiconIdempotencyKey" ("expiresAt");

CREATE TABLE IF NOT EXISTS "LexiconBulkJob" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "idempotencyKey" text,
  "status" text NOT NULL DEFAULT 'queued',
  "mode" text NOT NULL,
  "rowCount" integer NOT NULL,
  "processed" integer NOT NULL DEFAULT 0,
  "rollup" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "claimedBy" text,
  "claimedAt" timestamptz,
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "LexiconBulkJob_userId_User_id_fk"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
  CONSTRAINT "LexiconBulkJob_status_check" CHECK (
    "status" IN ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT "LexiconBulkJob_mode_check" CHECK (
    "mode" IN ('sync', 'async')
  ),
  CONSTRAINT "LexiconBulkJob_processed_check" CHECK (
    "rowCount" > 0 AND "processed" >= 0 AND "processed" <= "rowCount"
  ),
  CONSTRAINT "LexiconBulkJob_rollup_shape_check" CHECK (
    jsonb_typeof("rollup") = 'object'
  ),
  CONSTRAINT "LexiconBulkJob_errors_shape_check" CHECK (
    jsonb_typeof("errors") = 'array'
  )
);

CREATE INDEX IF NOT EXISTS "LexiconBulkJob_userId_createdAt_idx"
  ON "LexiconBulkJob" ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "LexiconBulkJob_status_createdAt_idx"
  ON "LexiconBulkJob" ("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "LexiconBulkJob_user_idem_unique"
  ON "LexiconBulkJob" ("userId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

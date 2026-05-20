-- V2: CronJobLease — mutex for cron jobs invokable from multiple places.
--
-- We deliberately want both Cloudflare Workers scheduled() AND external
-- HTTP callers (GitHub Actions, ops curl) to be able to fire the same
-- job. The unique index on (job_name, window_start) plus
-- "INSERT…ON CONFLICT DO NOTHING" makes the first writer win at the DB
-- layer — no distributed lock service needed.
--
-- status values:
--   'running' → row was inserted; the inserter owns execution
--   'done'    → execution finished successfully
--   'failed'  → execution threw; error_message captures the reason
--
-- Retention: a separate GC (left for later if it ever matters) drops
-- rows older than ~30 days; the row count stays bounded by
-- (cron-count × runs/day × 30) which is well under 10k for the
-- foreseeable future.

CREATE TABLE IF NOT EXISTS "CronJobLease" (
  "id" text PRIMARY KEY NOT NULL,
  "job_name" text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "acquired_at" timestamptz NOT NULL DEFAULT now(),
  "acquired_by" text NOT NULL,
  "completed_at" timestamptz,
  "status" text NOT NULL,
  "error_message" text,
  CONSTRAINT "CronJobLease_status_check" CHECK (
    "status" IN ('running', 'done', 'failed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "CronJobLease_job_window_unique"
  ON "CronJobLease" ("job_name", "window_start");

CREATE INDEX IF NOT EXISTS "CronJobLease_status_idx"
  ON "CronJobLease" ("status", "acquired_at" DESC);

CREATE INDEX IF NOT EXISTS "CronJobLease_acquired_at_idx"
  ON "CronJobLease" ("acquired_at" DESC);

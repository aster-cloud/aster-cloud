-- License usage telemetry (SaaS-only ingest table).
--
-- One row per opt-in upload from an on-prem deployment. Captures
-- aggregate usage metrics; never PII / never raw event content.
-- Drives renewal-time data ("did this customer hit their seat cap?",
-- "did they actually use the features we charged for?").
--
-- Storage model:
--   - payload jsonb so the schema can evolve without migration churn —
--     producers add optional fields, consumers ignore unknown.
--   - period_start + period_end frame the reporting window the producer
--     observed (typically prior 7 days). Allows ops to spot gaps.
--   - received_at + source_ip are server-set audit fields, not in the
--     uploader payload — defense against producer clock skew + ability
--     to correlate with WAF/CDN logs.
--   - signature_kid + signature_alg + signature_b64 captured verbatim
--     so we can re-verify offline if a dispute arises.
--
-- Retention:
--   12 months rolling (compliance + renewal-cycle need). Older rows
--   garbage-collected by a separate cron not implemented here.
--
-- Indexes match the two query shapes we care about:
--   1. "give me the latest N reports for license X" → admin panel + renewal review
--   2. "did we receive anything for license X in the last 30 days?" → ops health check

CREATE TABLE IF NOT EXISTS "LicenseTelemetry" (
  "id" text PRIMARY KEY,
  "license_id" text NOT NULL,
  "deployment_id" text NOT NULL,
  "customer" text NOT NULL,
  "period_start" timestamptz NOT NULL,
  "period_end" timestamptz NOT NULL,
  "payload" jsonb NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "source_ip" text,
  "signature_kid" text NOT NULL,
  "signature_alg" text NOT NULL,
  "signature_b64" text NOT NULL,
  -- 防 replay：(license_id, period_start, period_end) 整窗只接受一次。
  -- producer 重试同一窗口被 ON CONFLICT DO NOTHING 静默；接受 idempotent
  -- 上报是约定的一部分（uploader 可以重试无副作用）。
  CONSTRAINT "LicenseTelemetry_unique_window"
    UNIQUE ("license_id", "period_start", "period_end")
);

-- 1) admin panel：按 license 倒序取最近 N 条
CREATE INDEX IF NOT EXISTS "LicenseTelemetry_license_received_idx"
  ON "LicenseTelemetry" ("license_id", "received_at" DESC);

-- 2) ops health：扫 received_at 范围找哪些 license 该上报没上报
CREATE INDEX IF NOT EXISTS "LicenseTelemetry_received_idx"
  ON "LicenseTelemetry" ("received_at");

-- 3) customer-wide rollup（销售用：把同 customer 多套部署聚合）
CREATE INDEX IF NOT EXISTS "LicenseTelemetry_customer_received_idx"
  ON "LicenseTelemetry" ("customer", "received_at" DESC);

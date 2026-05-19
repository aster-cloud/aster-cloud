-- Access audit for LicenseTelemetry (SaaS-only).
--
-- SOC 2 CC6.1 / ISO 27001 A.12.4.1 require "who accessed personal data
-- when". LicenseTelemetry rows aggregate per-deployment activity (low
-- sensitivity) but customer + period contextualize them, so we keep a
-- conservative log of admin reads and any deletions.
--
-- Row shape:
--   action      ∈ {'read-list', 'read-single', 'delete-customer',
--                  'delete-license', 'delete-by-dsar', 'retention-gc'}
--   actorId     SaaS admin user id, OR 'system' for automated paths
--   subjectKind ∈ {'license', 'customer', 'row', 'all-customer'}
--   subjectKey  the entity that was acted on (license_id / customer name
--               / telemetry row id)
--   metadata    arbitrary jsonb for context (count, request id, dsar ref)
--
-- Retention: 7 years for delete events (legal hold). 90 days for reads
-- (we don't need a forensic depth on reads, but enough to spot snooping).
-- Two retention windows so we don't blow the table up.

CREATE TABLE IF NOT EXISTS "TelemetryAccessAudit" (
  "id" text PRIMARY KEY,
  "at" timestamptz NOT NULL DEFAULT now(),
  "action" text NOT NULL,
  "actor_id" text NOT NULL,
  "actor_email" text,
  "subject_kind" text NOT NULL,
  "subject_key" text NOT NULL,
  "metadata" jsonb,
  "request_id" text,
  CONSTRAINT "TelemetryAccessAudit_action_check" CHECK (
    "action" IN (
      'read-list',
      'read-single',
      'delete-customer',
      'delete-license',
      'delete-by-dsar',
      'retention-gc'
    )
  )
);

CREATE INDEX IF NOT EXISTS "TelemetryAccessAudit_at_idx"
  ON "TelemetryAccessAudit" ("at" DESC);

CREATE INDEX IF NOT EXISTS "TelemetryAccessAudit_subject_idx"
  ON "TelemetryAccessAudit" ("subject_kind", "subject_key");

CREATE INDEX IF NOT EXISTS "TelemetryAccessAudit_actor_idx"
  ON "TelemetryAccessAudit" ("actor_id", "at" DESC);

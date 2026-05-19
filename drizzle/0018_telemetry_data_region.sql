-- Add data region marker to LicenseTelemetry rows.
--
-- GDPR Art 44 cross-border transfer rule requires being able to prove
-- where data was processed. We tag each ingested row with the region
-- of the SaaS instance that accepted it (us / eu / apac). At the time
-- of writing Aster runs a single region; this prepares for future
-- per-region replicas so a single migration doesn't need a backfill.

ALTER TABLE "LicenseTelemetry"
  ADD COLUMN IF NOT EXISTS "data_region" text;

-- Backfill historical rows with 'unknown' so we can later distinguish
-- "row that pre-dates region tagging" from "row tagged after migration".
UPDATE "LicenseTelemetry"
  SET "data_region" = 'unknown'
  WHERE "data_region" IS NULL;

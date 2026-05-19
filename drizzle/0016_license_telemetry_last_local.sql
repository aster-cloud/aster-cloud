-- On-prem-side log of the last telemetry upload attempt.
--
-- Lets the admin/license page show ops what was sent + when, satisfying
-- the "transparency" half of opt-in telemetry (you can see exactly what
-- left your network). Stored as jsonb on LicenseCache (singleton on-prem
-- table) to avoid a new dedicated table for one record.

ALTER TABLE "LicenseCache"
  ADD COLUMN IF NOT EXISTS "last_telemetry_upload" jsonb;

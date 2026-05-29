-- User-managed Domain Vocabularies (B11).
--
-- Adds `LexiconBulkJob.inputJson` so async bulk imports can persist the
-- caller's full term payload and let the bulk worker process it across
-- multiple invocations without re-uploading. Sync imports leave it NULL.
--
-- Existing rows (sync completed jobs from B10) have no input to preserve,
-- so the column ships nullable.

ALTER TABLE "LexiconBulkJob"
  ADD COLUMN IF NOT EXISTS "inputJson" jsonb;

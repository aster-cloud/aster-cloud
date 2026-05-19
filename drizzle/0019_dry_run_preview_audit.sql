-- J5: extend the audit action enum to include 'dry-run-preview' so the
-- DSAR API can record preview-without-commit operations alongside real
-- deletions. Counts as a READ for retention (90 days), not a DELETE
-- (7-year hold).
--
-- Drop + recreate the CHECK constraint because PostgreSQL doesn't have
-- an in-place "add value to CHECK". Cheap on the audit table (CHECK
-- re-evaluation reads each row once but the table is small until you've
-- been operating for months — runs in seconds even at production scale).

ALTER TABLE "TelemetryAccessAudit"
  DROP CONSTRAINT IF EXISTS "TelemetryAccessAudit_action_check";

ALTER TABLE "TelemetryAccessAudit"
  ADD CONSTRAINT "TelemetryAccessAudit_action_check" CHECK (
    "action" IN (
      'read-list',
      'read-single',
      'delete-customer',
      'delete-license',
      'delete-by-dsar',
      'retention-gc',
      'dry-run-preview'
    )
  );

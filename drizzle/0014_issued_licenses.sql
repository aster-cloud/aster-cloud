-- Issued license audit table (SaaS-only).
--
-- One row per license ever signed — first sale and every renewal. License
-- key bytes are NOT stored (with-display-once contract); we keep
-- payload_json + payload_hash for audit, plus the lineage pointers
-- needed to drive lifecycle (`renewedFromLicenseId` + `supersededBy`).
--
-- Supersedure model:
--   When customer pays a renewal, the new license is inserted with
--   renewed_from_license_id = <old>. After RENEWAL_OVERLAP_DAYS the old
--   row gets superseded_at + superseded_by populated and is added to
--   the revocation manifest. Old license keeps verifying during overlap
--   so customer has time to ship the new env vars.

CREATE TABLE IF NOT EXISTS "IssuedLicense" (
  "license_id" text PRIMARY KEY,
  "customer" text NOT NULL,
  "deployment_binding" jsonb NOT NULL,
  "payload_json" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "signing_key_id" text NOT NULL,
  "signed_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "tier" text NOT NULL,
  "license_term" text NOT NULL,
  "stripe_subscription_id" text,
  "stripe_checkout_session_id" text,
  "renewed_from_license_id" text,
  "superseded_at" timestamptz,
  "superseded_by" text
);

-- Reverse lookup: webhook handler resolves Stripe session/sub → row
CREATE INDEX IF NOT EXISTS "IssuedLicense_stripe_session_idx"
  ON "IssuedLicense" ("stripe_checkout_session_id")
  WHERE "stripe_checkout_session_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IssuedLicense_stripe_subscription_idx"
  ON "IssuedLicense" ("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;

-- Customer history (latest license shown first in ops UI)
CREATE INDEX IF NOT EXISTS "IssuedLicense_customer_expires_idx"
  ON "IssuedLicense" ("customer", "expires_at" DESC);

-- Lineage navigation: "what replaced lic_X?" / "what did lic_Y supersede?"
CREATE INDEX IF NOT EXISTS "IssuedLicense_renewed_from_idx"
  ON "IssuedLicense" ("renewed_from_license_id")
  WHERE "renewed_from_license_id" IS NOT NULL;

-- Overlap-expiry cron filter: rows still active with a successor
CREATE INDEX IF NOT EXISTS "IssuedLicense_pending_supersede_idx"
  ON "IssuedLicense" ("superseded_by", "expires_at")
  WHERE "superseded_at" IS NULL AND "superseded_by" IS NOT NULL;

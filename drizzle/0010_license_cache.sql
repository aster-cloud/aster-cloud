-- License v2 verification cache + SaaS revocation publisher tables.
--
-- 在两种 deployment mode 下都存在以保持 schema 一致：
--   - on-prem 写 "LicenseCache"（单行 id='current'）
--   - SaaS 写 "RevokedLicense" + 不可变 "RevocationPublication"

CREATE TABLE IF NOT EXISTS "LicenseCache" (
    "id" text PRIMARY KEY DEFAULT 'current',
    "license_id" text NOT NULL,
    "license_key_hash" text NOT NULL,
    "payload_json" jsonb NOT NULL,
    "signing_key_id" text NOT NULL,
    "verified_at" timestamptz NOT NULL,
    "revocation_version" bigint,
    "revocation_published_at" timestamptz,
    "revocation_fetched_at" timestamptz,
    "last_successful_revocation_check_at" timestamptz,
    "last_revocation_error" jsonb,
    "is_revoked" boolean NOT NULL DEFAULT false,
    "revoked_at" timestamptz,
    "revoked_reason" text,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "LicenseCache_id_current_check" CHECK ("id" = 'current')
);

CREATE TABLE IF NOT EXISTS "RevokedLicense" (
    "license_id" text PRIMARY KEY,
    "revoked_at" timestamptz NOT NULL DEFAULT now(),
    "revoked_by" text NOT NULL,
    "reason" text NOT NULL,
    "notes" text,
    "customer_ref" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "RevokedLicense_revokedAt_idx"
    ON "RevokedLicense" ("revoked_at");

CREATE TABLE IF NOT EXISTS "RevocationPublication" (
    "version" bigint PRIMARY KEY,
    "published_at" timestamptz NOT NULL DEFAULT now(),
    "valid_until" timestamptz NOT NULL,
    "revoked_count" integer NOT NULL,
    "signed_doc" text NOT NULL,
    "signature" text NOT NULL,
    CONSTRAINT "RevocationPublication_version_positive_check" CHECK ("version" > 0),
    CONSTRAINT "RevocationPublication_revoked_count_nonnegative_check" CHECK ("revoked_count" >= 0)
);

CREATE INDEX IF NOT EXISTS "RevocationPub_publishedAt_idx"
    ON "RevocationPublication" ("published_at" DESC);

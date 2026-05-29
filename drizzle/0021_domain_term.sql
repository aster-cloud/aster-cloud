-- User-managed Domain Vocabularies (B1/B2 of user-domain-vocabulary plan).
--
-- Design decisions encoded here:
--   - DomainTerm is a global deduplicated catalogue. User edits never mutate
--     shared rows; they repoint a UserDomainTerm link to a new or existing row.
--     The dedupKey is a hash over the normalized (domain, locale, kind,
--     canonicalNorm, localizedNorm, parentCanonicalNorm) tuple so that
--     ON CONFLICT DO NOTHING handles the upsert race at the DB layer.
--   - UserDomainTerm owns the per-user active vocabulary surface and a
--     soft-delete + archive lifecycle. v1 enforces ownerType='user' via a
--     CHECK constraint; teamId is reserved (nullable) for v2 team-shared
--     vocabularies and intentionally constrained NULL today.
--   - UserVocabularySnapshot freezes publish-time content so policy versions
--     remain reproducible and rollback can restore an exact term set. The
--     contentHash unique index gives us automatic de-duplication: N publishes
--     of the same vocabulary collapse to a single row with bumped refCount.
--   - PolicyVersion.vocabularySnapshotIds is jsonb (not FK) because one
--     published version can pin multiple domain/locale vocabularies. The
--     application layer reads termIds out and resolves them; storing FKs in a
--     jsonb array is acceptable because snapshots never hard-delete.
--
-- Concurrency note: drizzle-kit migrations in this repo are journaled with
-- per-file breakpoints (see drizzle/meta/_journal.json) and execute inside a
-- single transaction per file. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction, so it's not used here. These three tables are brand-new and
-- empty at apply time, making non-concurrent index creation safe and fast.
-- Later additive indexes on populated tables should ship as their own
-- non-transactional migration files.

ALTER TABLE "PolicyVersion"
  ADD COLUMN IF NOT EXISTS "vocabularySnapshotIds" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- --------------------------------------------------------------------------
-- DomainTerm (global deduplicated catalogue)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "DomainTerm" (
  "id" text PRIMARY KEY NOT NULL,
  "domain" text NOT NULL,
  "locale" text NOT NULL,
  "kind" text NOT NULL,
  "canonical" text NOT NULL,
  "canonicalNorm" text NOT NULL,
  "localized" text NOT NULL,
  "localizedNorm" text NOT NULL,
  "parentCanonical" text,
  "parentCanonicalNorm" text,
  "description" text,
  "aliases" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "version" integer NOT NULL DEFAULT 1,
  "dedupKey" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "deprecatedAt" timestamptz,
  "deprecatedReason" text,
  CONSTRAINT "DomainTerm_kind_check" CHECK (
    "kind" IN ('struct', 'field', 'function', 'enum_value')
  ),
  CONSTRAINT "DomainTerm_source_check" CHECK (
    "source" IN ('builtin', 'user', 'admin_seed')
  ),
  CONSTRAINT "DomainTerm_status_check" CHECK (
    "status" IN ('active', 'deprecated')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "DomainTerm_dedupKey_unique"
  ON "DomainTerm" ("dedupKey");

CREATE INDEX IF NOT EXISTS "DomainTerm_domain_locale_kind_idx"
  ON "DomainTerm" ("domain", "locale", "kind");

CREATE INDEX IF NOT EXISTS "DomainTerm_status_idx"
  ON "DomainTerm" ("status");

CREATE INDEX IF NOT EXISTS "DomainTerm_canonicalNorm_idx"
  ON "DomainTerm" ("canonicalNorm");

CREATE INDEX IF NOT EXISTS "DomainTerm_localizedNorm_idx"
  ON "DomainTerm" ("localizedNorm");

-- --------------------------------------------------------------------------
-- UserVocabularySnapshot (declared before UserDomainTerm because the link
-- table references this for its archiveSnapshotId column)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "UserVocabularySnapshot" (
  "id" text PRIMARY KEY NOT NULL,
  "ownerType" text NOT NULL,
  "ownerId" text NOT NULL,
  "domain" text NOT NULL,
  "locale" text NOT NULL,
  "version" integer NOT NULL,
  "vocabularyJson" jsonb NOT NULL,
  "termIds" jsonb NOT NULL,
  "contentHash" text NOT NULL,
  "refCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "archivedAt" timestamptz,
  CONSTRAINT "UserVocabularySnapshot_ownerType_check" CHECK (
    "ownerType" IN ('user', 'team')
  ),
  CONSTRAINT "UserVocabularySnapshot_refCount_check" CHECK ("refCount" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserVocabularySnapshot_owner_version_unique"
  ON "UserVocabularySnapshot" (
    "ownerType",
    "ownerId",
    "domain",
    "locale",
    "version"
  );

CREATE UNIQUE INDEX IF NOT EXISTS "UserVocabularySnapshot_owner_hash_unique"
  ON "UserVocabularySnapshot" (
    "ownerType",
    "ownerId",
    "domain",
    "locale",
    "contentHash"
  );

CREATE INDEX IF NOT EXISTS "UserVocabularySnapshot_refCount_idx"
  ON "UserVocabularySnapshot" ("refCount");

-- --------------------------------------------------------------------------
-- UserDomainTerm (per-user active link with soft-delete + archive)
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "UserDomainTerm" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "termId" text NOT NULL,
  "ownerType" text NOT NULL DEFAULT 'user',
  "teamId" text,
  "domain" text NOT NULL,
  "locale" text NOT NULL,
  "kind" text NOT NULL,
  "note" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "deletedAt" timestamptz,
  "deletedBy" text,
  "deletedReason" text,
  "archivedAt" timestamptz,
  "archiveSnapshotId" text,
  CONSTRAINT "UserDomainTerm_userId_User_id_fk"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
  CONSTRAINT "UserDomainTerm_termId_DomainTerm_id_fk"
    FOREIGN KEY ("termId") REFERENCES "DomainTerm" ("id") ON DELETE RESTRICT,
  CONSTRAINT "UserDomainTerm_teamId_Team_id_fk"
    FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE,
  CONSTRAINT "UserDomainTerm_archiveSnapshotId_UserVocabularySnapshot_id_fk"
    FOREIGN KEY ("archiveSnapshotId") REFERENCES "UserVocabularySnapshot" ("id"),
  CONSTRAINT "UserDomainTerm_owner_v1_check" CHECK (
    "ownerType" = 'user'
    AND "userId" IS NOT NULL
    AND "teamId" IS NULL
  )
);

-- "active" means neither soft-deleted nor archived. Archived rows
-- (90-day retention bucket for downgraded users) must not block
-- re-adding the same term after the user upgrades back to Pro.
CREATE UNIQUE INDEX IF NOT EXISTS "UserDomainTerm_active_unique"
  ON "UserDomainTerm" ("userId", "termId")
  WHERE "deletedAt" IS NULL AND "archivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "UserDomainTerm_user_domain_idx"
  ON "UserDomainTerm" ("userId", "domain", "locale")
  WHERE "deletedAt" IS NULL AND "archivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "UserDomainTerm_termId_idx"
  ON "UserDomainTerm" ("termId")
  WHERE "deletedAt" IS NULL AND "archivedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "UserDomainTerm_archive_idx"
  ON "UserDomainTerm" ("archivedAt", "deletedAt");

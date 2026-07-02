CREATE TABLE IF NOT EXISTS "StructuralAliasGrant" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "grantedBy" text NOT NULL,
  "grantedAt" timestamp DEFAULT now() NOT NULL,
  "revokedAt" timestamp,
  CONSTRAINT "StructuralAliasGrant_userId_User_id_fk"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
  CONSTRAINT "StructuralAliasGrant_grantedBy_User_id_fk"
    FOREIGN KEY ("grantedBy") REFERENCES "User" ("id") ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS "StructuralAliasGrant_userId_idx"
  ON "StructuralAliasGrant" ("userId");

CREATE INDEX IF NOT EXISTS "StructuralAliasGrant_active_idx"
  ON "StructuralAliasGrant" ("userId")
  WHERE "revokedAt" IS NULL;

-- Force password rotation flag.
--
-- Set to true when an account is provisioned with a temporary
-- password (admin bootstrap via `pnpm seed:admin`, or future
-- admin-issued invitations). The dashboard layout reads this flag
-- and redirects to /onboarding/change-password before allowing any
-- other navigation. Cleared by the change-password endpoint on
-- successful rotation.

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean NOT NULL DEFAULT false;

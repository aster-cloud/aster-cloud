import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, users } from '@/lib/prisma';
import { ensureAdminSeeded, ensureSchemaApplied } from '@/lib/db-bootstrap';
import { verifyPassword } from '@/auth';

/**
 * Diagnostic endpoint to confirm admin provisioning + password
 * authentication is wired correctly. Returns:
 *
 *   - whether the mustChangePassword column exists yet
 *   - whether ADMIN_EMAIL is set in the environment (NOT its value)
 *   - whether a user row with that email exists, and the flags
 *     visible to the admin gate
 *   - whether the configured ADMIN_INITIAL_PASSWORD actually
 *     bcrypt-verifies against the stored hash (so we know if the
 *     credentials path is broken vs the user data is broken)
 *
 * Gated behind a request-time secret query string param so it
 * doesn't leak diagnostic data via accidental URL sharing. Delete
 * once admin login is working.
 *
 *   GET /api/debug/admin-status?secret=<DEBUG_SECRET>
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.DEBUG_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'DEBUG_SECRET not configured' },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  if (url.searchParams.get('secret') !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Force the bootstrap to run (idempotent, advisory-lock guarded) so
  // we can be sure the column + admin row exist before inspecting.
  // We have to await BOTH phases explicitly — ensureSchemaApplied
  // only returns the schema-patch Promise and kicks off the seed in
  // the background, so without the second await the inspection runs
  // before the admin row is written.
  await ensureSchemaApplied();
  await ensureAdminSeeded();

  const db = getDb();

  // Does the column exist?
  const colCheck = await db.execute(sql`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_name = 'User'
       AND column_name = 'mustChangePassword'
  `);
  const columnExists = Array.isArray(colCheck) && colCheck.length > 0;

  const adminEmailRaw = process.env.ADMIN_EMAIL;
  const adminEmail = adminEmailRaw ? adminEmailRaw.toLowerCase().trim() : null;
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;

  const envState = {
    ADMIN_EMAIL_set: !!adminEmailRaw,
    ADMIN_EMAIL_normalized: adminEmail,
    ADMIN_INITIAL_PASSWORD_set: !!adminPassword,
    ADMIN_INITIAL_PASSWORD_length: adminPassword?.length ?? 0,
  };

  let userState: Record<string, unknown> = { found: false };
  let passwordCheck: Record<string, unknown> = {};

  if (adminEmail) {
    const row = await db.query.users.findFirst({
      where: eq(users.email, adminEmail),
      columns: {
        id: true,
        email: true,
        name: true,
        isAdmin: true,
        mustChangePassword: true,
        passwordHash: true,
        deletedAt: true,
        lockedUntil: true,
      },
    });
    if (row) {
      userState = {
        found: true,
        id: row.id,
        email: row.email,
        name: row.name,
        isAdmin: row.isAdmin,
        mustChangePassword: row.mustChangePassword,
        hasPasswordHash: !!row.passwordHash,
        passwordHashPrefix: row.passwordHash?.slice(0, 7) ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        lockedUntil: row.lockedUntil?.toISOString() ?? null,
      };
      // If both the env password and a stored hash exist, verify
      // them so we know if /api/auth/callback/credentials should be
      // accepting the temp password.
      if (adminPassword && row.passwordHash) {
        try {
          const ok = await verifyPassword(adminPassword, row.passwordHash);
          passwordCheck = {
            envPasswordMatchesStoredHash: ok,
          };
        } catch (err) {
          passwordCheck = {
            envPasswordMatchesStoredHash: false,
            verifyError: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }
  }

  return NextResponse.json({
    columnExists,
    env: envState,
    user: userState,
    passwordCheck,
    nextSteps: !columnExists
      ? 'Schema patch did not apply — check Worker logs for [db-bootstrap]'
      : !envState.ADMIN_EMAIL_set
        ? 'Set ADMIN_EMAIL on the Worker'
        : !envState.ADMIN_INITIAL_PASSWORD_set
          ? 'Set ADMIN_INITIAL_PASSWORD on the Worker'
          : !userState.found
            ? 'Bootstrap did not create the row — check Worker logs'
            : !userState.hasPasswordHash
              ? 'User exists but passwordHash is null — bootstrap may have skipped'
              : passwordCheck.envPasswordMatchesStoredHash === false
                ? 'Stored hash does not match env password — temp password rotated stale'
                : 'Everything looks healthy. Login should work.',
  });
}

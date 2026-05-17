/**
 * Boot-time schema patcher + admin seeder.
 *
 * Why this exists:
 *   We can't reach the production Postgres from the operator's laptop
 *   to run `pnpm db:push` or the seed-admin script — Hyperdrive is the
 *   only thing on the network with credentials. So we run the same
 *   work from inside the Worker on every cold start, guarded by:
 *
 *     1. Per-phase Promise caches so we only attempt each piece of
 *        work once per Worker instance, but admin seed and schema
 *        patch are cached independently (see below).
 *     2. `IF NOT EXISTS` on every DDL so re-applying a patch that
 *        already landed is a no-op even across concurrent isolates.
 *     3. Idempotent admin upsert: re-running for an existing email
 *        rotates the temp password + re-arms `mustChangePassword`,
 *        which is fine — the operator can re-seed if they forget the
 *        temp. Concurrent inserts race-protect via the User_email
 *        unique constraint; the loser treats 23505 as success.
 *
 * Why no Postgres advisory lock (despite the obvious appeal):
 *   pg_(try_)advisory_lock is session-scoped. Under Hyperdrive's
 *   connection pool the lock-acquire statement and the DDL may run
 *   on different pooled connections — the lock isn't held on the
 *   session that does the work. Worse, a Worker isolate that dies
 *   mid-bootstrap can leave the lock held on an orphaned pooled
 *   session indefinitely, permanently blocking every later isolate.
 *   `IF NOT EXISTS` + unique-constraint races give us idempotency
 *   without the foot-gun.
 *
 * What it does:
 *   - Adds User.mustChangePassword (migration 0009) if missing
 *   - If ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD env vars are set, seeds
 *     or refreshes the admin user with isAdmin=true +
 *     mustChangePassword=true
 *
 * Why the two phases are cached separately:
 *   Schema patch is immutable — once the column exists, it exists
 *   forever, so the Promise can be cached for the life of the Worker
 *   isolate.
 *
 *   Admin seed is NOT immutable: the operator may set ADMIN_EMAIL /
 *   ADMIN_INITIAL_PASSWORD *after* the first request lands. With a
 *   single shared cache, the first request resolves the "env not set
 *   — skipping" branch successfully, caches the resolved Promise, and
 *   every later request short-circuits without re-attempting the
 *   seed even after the secrets are populated. We split the caches so
 *   the seed phase can retry on every cold start until it finds a
 *   provisioned admin (then it self-no-ops).
 *
 * It does NOT run on every request — only on the first request that
 * triggers `ensureSchemaApplied()`. Subsequent requests short-circuit
 * via the cached Promises rather than re-running.
 *
 * Failure mode: bootstrap errors are logged but don't throw — we'd
 * rather let the request continue and surface the underlying SQL
 * error at the actual call site than blanket-fail every request on
 * a transient connection blip.
 */

import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

/** Schema patch is immutable: once the column lands, no later request
 *  needs to retry. Safe to cache for the life of the isolate. */
let schemaPatchDone: Promise<void> | null = null;

/** Admin seed cache: we want to re-attempt until we've actually
 *  provisioned the admin row. A *resolved* Promise here means
 *  "we observed an isAdmin + rotated admin in the DB"; until that
 *  is true the cache stays null and every caller re-attempts. */
let adminSeedDone: Promise<void> | null = null;

export function ensureSchemaApplied(): Promise<void> {
  if (!schemaPatchDone) {
    schemaPatchDone = runSchemaPatch().catch((err) => {
      schemaPatchDone = null;
      console.error('[db-bootstrap] schema patch failed:', err);
    });
  }
  // Fire the admin seed in the background — we don't want to block
  // the request on it, but every cold request gets a chance to try
  // again until the admin row is finalized.
  ensureAdminSeeded();
  return schemaPatchDone;
}

/**
 * Idempotent admin seed. Cached only on *success* (i.e. when we
 * observe the admin row in the desired final state, or successfully
 * write it). Returns the in-flight Promise so concurrent callers
 * share the work, but a skip-or-fail clears the cache so the next
 * caller retries.
 */
export function ensureAdminSeeded(): Promise<void> {
  if (adminSeedDone) return adminSeedDone;
  adminSeedDone = runAdminSeed()
    .then((didFinalize) => {
      // Only keep the cache if we reached a terminal state — i.e.
      // the admin row exists and is correctly flagged. Otherwise
      // (env vars missing, transient skip), clear so the next caller
      // re-attempts.
      if (!didFinalize) {
        adminSeedDone = null;
      }
    })
    .catch((err) => {
      adminSeedDone = null;
      console.error('[db-bootstrap] admin seed failed:', err);
    });
  return adminSeedDone;
}

async function runSchemaPatch(): Promise<void> {
  const db = getDb();

  // No advisory lock needed: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  // is atomic in Postgres and a no-op if the column already exists.
  // The session-scoped lock approach (pg_try_advisory_lock) is unsafe
  // under Hyperdrive — different statements may run on different
  // pooled connections, so the lock is held on a session we may not
  // execute the DDL on, and a Worker isolate that dies mid-bootstrap
  // can leave the lock held indefinitely.
  await db.execute(
    sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean NOT NULL DEFAULT false`,
  );
  console.warn('[db-bootstrap] schema patch 0009 applied');
}

/**
 * Returns true if the admin seed reached a terminal state worth
 * caching (admin row exists with isAdmin=true), false if it was
 * skipped or otherwise non-final.
 */
async function runAdminSeed(): Promise<boolean> {
  const adminEmailRaw = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!adminEmailRaw || !adminPassword) {
    console.warn(
      '[db-bootstrap] ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD not set — skipping admin seed (will retry on next request)',
    );
    return false;
  }

  // No advisory lock: the seed is already idempotent
  // (findFirst → update-or-insert), and concurrent inserts of the
  // same email are protected by the User_email_unique constraint
  // (the second insert will throw a unique-violation we treat as a
  // race-lost no-op).
  try {
    await seedAdmin(adminEmailRaw, adminPassword, process.env.ADMIN_NAME);
    return true;
  } catch (err) {
    // Surface as much error context as possible — drizzle's
    // `Failed query: ...` wrapper hides the underlying Postgres
    // detail/code by default. The Worker dashboard only renders
    // the top-level Error.message, so we manually pull out the
    // pg driver fields and log them.
    const e = err as {
      code?: string;
      detail?: string;
      message?: string;
      cause?: { code?: string; detail?: string; message?: string };
    } | null;
    const code = e?.code ?? e?.cause?.code;
    const detail = e?.detail ?? e?.cause?.detail;
    const causeMsg = e?.cause?.message;
    console.error(
      `[db-bootstrap] admin seed insert error: code=${code} detail=${detail} causeMsg=${causeMsg} topMsg=${e?.message}`,
    );

    // Postgres unique violation = another worker won the race.
    // Treat as success: the row exists, we just didn't write it.
    if (code === '23505') {
      console.warn(
        '[db-bootstrap] admin seed lost a race; another worker created the row',
      );
      return true;
    }
    throw err;
  }
}

async function seedAdmin(
  emailRaw: string,
  password: string,
  name: string | undefined,
): Promise<void> {
  if (password.length < 8) {
    console.error('[db-bootstrap] ADMIN_INITIAL_PASSWORD too short — skipping');
    return;
  }
  const email = emailRaw.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(password, 12);
  const db = getDb();

  // Case-insensitive lookup: an existing row may have been written
  // with mixed-case email (e.g. via GitHub OAuth's profile.email),
  // which would fail `eq` against our lowercased input and then
  // collide with the email unique constraint on insert.
  const existingRows = await db.execute(
    sql`SELECT id, "mustChangePassword", "isAdmin" FROM "User" WHERE LOWER(email) = ${email} LIMIT 1`,
  );
  const existing = Array.isArray(existingRows) && existingRows[0]
    ? (existingRows[0] as { id: string; mustChangePassword: boolean; isAdmin: boolean })
    : null;

  if (existing) {
    // Already rotated voluntarily — don't reset the temp password or
    // re-arm the rotate flag on every cold start.
    if (existing.isAdmin && !existing.mustChangePassword) {
      console.warn(
        `[db-bootstrap] admin ${email} already provisioned + rotated — no-op`,
      );
      return;
    }
    await db
      .update(users)
      .set({
        passwordHash,
        isAdmin: true,
        mustChangePassword: true,
      })
      .where(eq(users.id, existing.id));
    console.warn(
      `[db-bootstrap] refreshed admin ${email} (id=${existing.id})`,
    );
  } else {
    const id = randomUUID();
    await db.insert(users).values({
      id,
      email,
      name: name ?? 'Admin',
      passwordHash,
      isAdmin: true,
      mustChangePassword: true,
      emailVerified: new Date(),
      plan: 'pro',
    });
    console.warn(`[db-bootstrap] created admin ${email} (id=${id})`);
  }
}

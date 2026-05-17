/**
 * Boot-time schema patcher + admin seeder.
 *
 * Why this exists:
 *   We can't reach the production Postgres from the operator's laptop
 *   to run `pnpm db:push` or the seed-admin script — Hyperdrive is the
 *   only thing on the network with credentials. So we run the same
 *   work from inside the Worker on every cold start, guarded by:
 *
 *     1. A process-level `bootstrapDone` flag so we only attempt it
 *        once per Worker instance (re-runs cost ~one round-trip but
 *        are still wasteful at scale).
 *     2. A Postgres advisory lock so concurrent Worker instances
 *        don't race the same DDL.
 *     3. `IF NOT EXISTS` on every DDL so re-applying a patch that
 *        already landed is a no-op.
 *     4. Idempotent admin upsert: re-running for an existing email
 *        rotates the temp password + re-arms `mustChangePassword`,
 *        which is fine — the operator can re-seed if they forget the
 *        temp.
 *
 * What it does:
 *   - Adds User.mustChangePassword (migration 0009) if missing
 *   - If ADMIN_EMAIL + ADMIN_INITIAL_PASSWORD env vars are set, seeds
 *     or refreshes the admin user with isAdmin=true +
 *     mustChangePassword=true
 *
 * It does NOT run on every request — only on the first request that
 * triggers `ensureSchemaApplied()`. Subsequent requests short-circuit
 * via the `bootstrapDone` Promise cache so they share the same
 * in-flight bootstrap rather than re-running it.
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

/** Postgres advisory lock key — arbitrary unique int32 (fits the
 *  single-arg pg_try_advisory_lock signature without BigInt). */
const BOOTSTRAP_LOCK_KEY = 1145394001; // "aster-bootstrap" hash, arbitrary

/** Cache the in-flight (or completed) bootstrap so concurrent callers
 *  share one Promise rather than racing. */
let bootstrapDone: Promise<void> | null = null;

export function ensureSchemaApplied(): Promise<void> {
  if (!bootstrapDone) {
    bootstrapDone = runBootstrap().catch((err) => {
      // Reset so the next request can retry — useful when the first
      // attempt hit a transient connection blip.
      bootstrapDone = null;
      console.error('[db-bootstrap] failed:', err);
      // Swallow: callers should not crash on bootstrap failure.
    });
  }
  return bootstrapDone;
}

async function runBootstrap(): Promise<void> {
  const db = getDb();

  // pg_try_advisory_lock returns true if we acquired the lock, false
  // otherwise. False here means another worker is mid-bootstrap;
  // bail out — the work will be done by them, and the next request
  // will see the applied schema.
  const lockRes = await db.execute(
    sql`SELECT pg_try_advisory_lock(${sql.raw(BOOTSTRAP_LOCK_KEY.toString())}) AS got`,
  );
  const got = Array.isArray(lockRes)
    ? Boolean(
        (lockRes[0] as { got?: boolean } | undefined)?.got,
      )
    : false;
  if (!got) {
    console.warn('[db-bootstrap] another worker holds the lock; skipping');
    return;
  }

  try {
    // ---- Migration 0009: User.mustChangePassword ----
    // IF NOT EXISTS makes this safe to re-run after `pnpm db:push`
    // has already added the column.
    await db.execute(
      sql`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" boolean NOT NULL DEFAULT false`,
    );
    console.warn('[db-bootstrap] schema patch 0009 applied');

    // ---- Admin user seed (optional) ----
    // Only runs when both env vars are present. The operator sets
    // these on the Worker as secrets; once the admin has rotated
    // their password they can rotate / remove the env vars too
    // (idempotent re-seed will just re-arm mustChangePassword,
    // which is annoying but recoverable via change-password again).
    const adminEmailRaw = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (adminEmailRaw && adminPassword) {
      await seedAdmin(adminEmailRaw, adminPassword, process.env.ADMIN_NAME);
    } else {
      console.warn(
        '[db-bootstrap] ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD not set — skipping admin seed',
      );
    }
  } finally {
    await db.execute(
      sql`SELECT pg_advisory_unlock(${sql.raw(BOOTSTRAP_LOCK_KEY.toString())})`,
    );
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

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, mustChangePassword: true, isAdmin: true },
  });

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

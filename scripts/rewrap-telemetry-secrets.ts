/**
 * One-shot migration: envelope-encrypt every plaintext telemetry HMAC
 * secret currently sitting in IssuedLicense.payload_json.telemetry.secrets[].
 *
 * Why a separate script rather than a SQL migration:
 *   The secrets are nested inside a jsonb blob, and the wrap operation
 *   needs the KEK loaded from env — that's application-layer, not
 *   schema-layer. drizzle migrations run before app code has access
 *   to a key, so this lives as a maintenance script run from a one-shot
 *   Job (see k3s/apps/aster-lang/cloud/rewrap-secrets-job.yaml when
 *   provisioned).
 *
 * Idempotency:
 *   Each row is scanned; entries already in the v=1 envelope shape are
 *   left alone, plaintext entries are wrapped under the active KEK and
 *   the `secret` field is stripped. Re-running after a successful pass
 *   is a no-op (no rows match the "has plaintext" predicate).
 *
 * Atomicity:
 *   Each license row is updated in a single statement; we do not span
 *   transactions across rows. A crash mid-walk leaves some rows
 *   migrated and some untouched, and a re-run picks up the rest. The
 *   resolver (secret-store) handles both shapes during the overlap.
 *
 * Safety:
 *   --dry-run prints what would change without writing. Default is
 *   dry-run; pass --apply to actually rewrite. We also fail loudly if
 *   the KEK isn't configured rather than corrupt rows with an empty
 *   wrap.
 *
 * Usage:
 *   ASTER_TELEMETRY_SECRET_KEK=<hex32> \
 *   ASTER_TELEMETRY_SECRET_KEK_KID=kek-2026-05 \
 *   DATABASE_URL=postgres://... \
 *   pnpm tsx scripts/rewrap-telemetry-secrets.ts [--apply]
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../src/db/schema';
import {
  isWrappedSecret,
  loadKekFromEnv,
  wrapSecret,
} from '../src/lib/telemetry/envelope';

interface RewrapStats {
  rowsScanned: number;
  rowsWithTelemetry: number;
  secretsWrapped: number;
  rowsUpdated: number;
  rowsSkipped: number;
}

interface PlaintextSecretEntry {
  kid: string;
  secret: string;
  activatedAt: string;
  retiredAt?: string;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[rewrap] DATABASE_URL is required');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  // Fail-fast on missing KEK *before* we open a DB connection.
  loadKekFromEnv();

  const sql = postgres(url, { max: 2, idle_timeout: 5, connect_timeout: 10 });
  const db = drizzle(sql, { schema });

  const stats: RewrapStats = {
    rowsScanned: 0,
    rowsWithTelemetry: 0,
    secretsWrapped: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
  };

  console.log(`[rewrap] mode=${apply ? 'APPLY' : 'dry-run'} starting…`);
  const rows = await db.query.issuedLicenses.findMany();
  for (const row of rows) {
    stats.rowsScanned++;
    const updated = rewrapPayload(row.payloadJson);
    if (!updated) {
      stats.rowsSkipped++;
      continue;
    }
    stats.rowsWithTelemetry++;
    stats.secretsWrapped += updated.wrappedCount;
    if (updated.wrappedCount === 0) {
      // Telemetry config present but all secrets already wrapped.
      stats.rowsSkipped++;
      continue;
    }
    console.log(
      `[rewrap] license=${row.licenseId} customer=${row.customer} wrapping ${updated.wrappedCount} secret(s)`,
    );
    if (apply) {
      await db
        .update(schema.issuedLicenses)
        .set({ payloadJson: updated.payload })
        .where(eq(schema.issuedLicenses.licenseId, row.licenseId));
      stats.rowsUpdated++;
    }
  }

  await sql.end();
  console.log('[rewrap] done');
  console.log(JSON.stringify(stats, null, 2));
  if (!apply && stats.secretsWrapped > 0) {
    console.log('[rewrap] dry-run: re-run with --apply to persist changes');
  }
}

interface RewrapResult {
  payload: Record<string, unknown>;
  wrappedCount: number;
}

function rewrapPayload(payloadJson: unknown): RewrapResult | null {
  if (!payloadJson || typeof payloadJson !== 'object') return null;
  const payload = { ...(payloadJson as Record<string, unknown>) };
  const telemetry = payload.telemetry;
  if (!telemetry || typeof telemetry !== 'object') return null;
  const t = { ...(telemetry as Record<string, unknown>) };
  const secretsRaw = t.secrets;
  if (!Array.isArray(secretsRaw)) return null;

  let wrappedCount = 0;
  const newSecrets = secretsRaw.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const o = entry as Record<string, unknown>;
    // Already wrapped — leave verbatim.
    if (isWrappedSecret(o)) return o;
    // Plaintext shape — must have kid + secret + activatedAt.
    if (
      typeof o.kid !== 'string' ||
      typeof o.secret !== 'string' ||
      typeof o.activatedAt !== 'string'
    ) {
      return o;
    }
    const plain = o as unknown as PlaintextSecretEntry;
    const envelope = wrapSecret(plain.secret);
    wrappedCount++;
    // Result merges envelope fields with audit fields; drops `secret`.
    return {
      kid: plain.kid,
      activatedAt: plain.activatedAt,
      ...(plain.retiredAt ? { retiredAt: plain.retiredAt } : {}),
      ...envelope,
    };
  });

  t.secrets = newSecrets;
  payload.telemetry = t;
  return { payload, wrappedCount };
}

main().catch((err) => {
  console.error('[rewrap] unhandled error:', err);
  process.exit(2);
});

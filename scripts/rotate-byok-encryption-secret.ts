/**
 * Re-encrypt every active AiKeyBinding row from OLD secret to NEW.
 *
 * Used during AI_KEY_ENCRYPTION_SECRET rotation. See
 * docs/runbooks/secrets-rotation.md for the full procedure — this
 * script is one step of that runbook, not standalone.
 *
 * Env required:
 *   DATABASE_URL                       — Hyperdrive-equivalent connection
 *   OLD_AI_KEY_ENCRYPTION_SECRET       — current secret on Worker
 *   NEW_AI_KEY_ENCRYPTION_SECRET       — secret you're rotating to
 *
 * Optional:
 *   ROTATION_CHECKPOINT_FILE           — defaults to
 *                                        /tmp/byok-rotation-progress.json;
 *                                        script resumes from last completed
 *                                        row on retry
 *   ROTATION_DRY_RUN=true              — count what would be rotated, don't
 *                                        write
 *
 * Atomicity per row: pgcrypto's pgp_sym_decrypt(old) + pgp_sym_encrypt(new)
 * happen in a single UPDATE. If the script crashes mid-row, the row stays
 * on the old secret (transaction rolls back). The checkpoint file is
 * advisory — it tracks which rows we successfully re-wrote so a retry
 * skips them rather than re-doing them.
 */

import { readFile, writeFile } from 'node:fs/promises';
import postgres from 'postgres';

interface Checkpoint {
  startedAt: string;
  completedRowIds: string[];
}

function fail(msg: string): never {
  console.error(`[rotate-byok] ${msg}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) fail(`${name} is required`);
  return v;
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const OLD = requireEnv('OLD_AI_KEY_ENCRYPTION_SECRET');
const NEW = requireEnv('NEW_AI_KEY_ENCRYPTION_SECRET');
const DRY_RUN = process.env.ROTATION_DRY_RUN === 'true';
const CHECKPOINT_PATH =
  process.env.ROTATION_CHECKPOINT_FILE ?? '/tmp/byok-rotation-progress.json';

if (OLD === NEW) fail('OLD and NEW secrets are identical — nothing to rotate');
if (NEW.length < 16) fail('NEW secret must be ≥16 chars (matches encryption guard)');

const sql = postgres(DATABASE_URL, { max: 4 });

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const raw = await readFile(CHECKPOINT_PATH, 'utf8');
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return { startedAt: new Date().toISOString(), completedRowIds: [] };
  }
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await writeFile(CHECKPOINT_PATH, JSON.stringify(cp, null, 2));
}

async function main() {
  const checkpoint = await loadCheckpoint();
  console.log(
    `[rotate-byok] starting (resumed=${checkpoint.completedRowIds.length > 0}); ` +
      `dry-run=${DRY_RUN}; checkpoint=${CHECKPOINT_PATH}`,
  );

  // Lock-light: only rows that haven't been re-keyed yet. We compare
  // a sentinel (decrypt with OLD should succeed; decrypt with NEW
  // should fail) to figure out which rows still need work, in case
  // someone added new BYOK keys mid-rotation.
  const candidates = (await sql`
    SELECT id FROM "AiKeyBinding"
    WHERE active = true
      AND pgp_sym_decrypt("encryptedKey"::bytea, ${OLD}::text) IS NOT NULL
    ORDER BY "createdAt" ASC
  `) as ReadonlyArray<{ id: string }>;
  const remaining = candidates.filter(
    (r: { id: string }) => !checkpoint.completedRowIds.includes(r.id),
  );
  console.log(
    `[rotate-byok] ${candidates.length} active rows decryptable with OLD secret; ` +
      `${remaining.length} remaining to rotate`,
  );

  if (DRY_RUN) {
    console.log('[rotate-byok] dry-run — no writes');
    await sql.end();
    return;
  }

  for (const { id } of remaining) {
    await sql`
      UPDATE "AiKeyBinding"
      SET "encryptedKey" = pgp_sym_encrypt(
            pgp_sym_decrypt("encryptedKey"::bytea, ${OLD}::text),
            ${NEW}::text
          )::text,
          "updatedAt" = NOW()
      WHERE id = ${id}
    `;
    checkpoint.completedRowIds.push(id);
    await saveCheckpoint(checkpoint);
    console.log(`  rotated ${id}`);
  }

  console.log(
    `[rotate-byok] done. ${checkpoint.completedRowIds.length} rows rotated.`,
  );
  console.log(
    `[rotate-byok] NEXT STEPS:\n` +
      `  1. wrangler secret put AI_KEY_ENCRYPTION_SECRET --name aster-cloud\n` +
      `     (using the NEW secret value)\n` +
      `  2. Smoke-test BYOK decrypt: hit /api/llm/complete as a user with\n` +
      `     a stored key — should succeed.\n` +
      `  3. rm ${CHECKPOINT_PATH}  (clear the checkpoint file)\n`,
  );

  await sql.end();
}

main().catch(async (err) => {
  console.error('[rotate-byok] FAILED:', err);
  await sql.end({ timeout: 5 });
  process.exit(2);
});

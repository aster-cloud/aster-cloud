#!/usr/bin/env node
/**
 * Post-build patch for `.next/standalone/server.js`.
 *
 * Next.js standalone output bakes `process.env.NODE_ENV = 'production'`
 * as the very first executable statement in server.js. The override is
 * unconditional — it runs before any of our application code or any
 * `.env` load — so on-prem operators who want to run the standalone
 * server with `NODE_ENV=development` (typical during integration tests
 * or licence-key dry-runs) can't do it without surgery.
 *
 * This script rewrites that line to *respect* any pre-existing
 * NODE_ENV value:
 *
 *   before:  process.env.NODE_ENV = 'production'
 *   after:   process.env.NODE_ENV = process.env.NODE_ENV || 'production'
 *
 * Idempotent — safe to run on already-patched output. No-op when the
 * standalone bundle wasn't built (e.g. SaaS-only OpenNext build).
 *
 * Wired into `build:next` via package.json (`build:next` is the entry
 * point both SaaS and on-prem use).
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_JS = join(__dirname, '..', '.next', 'standalone', 'server.js');

const NEEDLE_HARD = "process.env.NODE_ENV = 'production'";
const NEEDLE_HARD_DQ = 'process.env.NODE_ENV = "production"';
const REPLACEMENT = "process.env.NODE_ENV = process.env.NODE_ENV || 'production'";

async function main() {
  try {
    await access(SERVER_JS);
  } catch {
    console.log('[patch-standalone] no .next/standalone/server.js — skipping (likely SaaS build)');
    return;
  }

  const src = await readFile(SERVER_JS, 'utf8');

  if (src.includes(REPLACEMENT)) {
    console.log('[patch-standalone] already patched — no-op');
    return;
  }

  let patched = src;
  let matched = false;
  if (patched.includes(NEEDLE_HARD)) {
    patched = patched.replace(NEEDLE_HARD, REPLACEMENT);
    matched = true;
  } else if (patched.includes(NEEDLE_HARD_DQ)) {
    patched = patched.replace(NEEDLE_HARD_DQ, REPLACEMENT);
    matched = true;
  }

  if (!matched) {
    console.warn(
      '[patch-standalone] WARNING: standalone server.js does not contain the expected ' +
        'NODE_ENV assignment. Next.js may have changed the boilerplate; verify manually ' +
        'and update scripts/patch-standalone-server.mjs accordingly.',
    );
    return;
  }

  await writeFile(SERVER_JS, patched);
  console.log('[patch-standalone] patched NODE_ENV assignment to respect existing value');
}

await main();

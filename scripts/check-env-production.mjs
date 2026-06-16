/**
 * check-env-production.mjs  (GitHub #98)
 *
 * CI guard: `.env.production` is bundled into the client build, so EVERY key in
 * it must be a public (`NEXT_PUBLIC_*`) variable. A non-public key here would be
 * a secret leak — committed to git AND shipped to browsers. Real secrets belong
 * in the Cloudflare Pages dashboard, never in this file.
 *
 * Parses simple KEY=VALUE lines (ignoring blanks and `#` comments) and fails if
 * any assigned key is not prefixed with NEXT_PUBLIC_.
 *
 * Exit codes:
 *   0 = clean (or file absent — nothing to leak)
 *   1 = a non-public key was found, or the file is malformed
 *
 * Usage: node scripts/check-env-production.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', '.env.production');

if (!existsSync(FILE)) {
  console.log('✓ no .env.production present — nothing to check');
  process.exit(0);
}

const lines = readFileSync(FILE, 'utf-8').split(/\r?\n/);
const offenders = [];

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;

  // Allow an optional leading `export `.
  const stripped = line.replace(/^export\s+/, '');
  const eq = stripped.indexOf('=');
  if (eq === -1) {
    offenders.push({ lineNo: i + 1, key: stripped, why: 'not a KEY=VALUE assignment' });
    continue;
  }
  const key = stripped.slice(0, eq).trim();
  if (!key) {
    offenders.push({ lineNo: i + 1, key: '<empty>', why: 'empty key' });
    continue;
  }
  if (!key.startsWith('NEXT_PUBLIC_')) {
    offenders.push({ lineNo: i + 1, key, why: 'not NEXT_PUBLIC_* (would leak to client)' });
  }
}

if (offenders.length > 0) {
  console.error('✗ .env.production must contain only NEXT_PUBLIC_* keys:');
  for (const o of offenders) {
    console.error(`  line ${o.lineNo}: ${o.key} — ${o.why}`);
  }
  console.error('\n  Move non-public values to the Cloudflare Pages dashboard / secrets.');
  process.exit(1);
}

console.log('✓ .env.production contains only NEXT_PUBLIC_* keys');

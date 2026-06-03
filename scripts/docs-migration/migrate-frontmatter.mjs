#!/usr/bin/env node
/**
 * Idempotent frontmatter migration — adds `updated` and `apiVersion`
 * to every docs MDX file that lacks them. Existing values are never
 * overwritten so future per-page edits stay authoritative.
 *
 * `updated` defaults to the file's git last-modified date (the
 * authoritative "freshness" signal), falling back to the current date
 * for files not yet tracked. `apiVersion` defaults to `v1`.
 *
 * Re-run after every batch of docs edits — already-migrated files
 * are no-ops. The DocsTrustFooter component reads these fields at
 * render time to populate its public-info row.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DOCS_ROOT = resolve(REPO_ROOT, 'src/app/[locale]/docs');
const DEFAULT_API_VERSION = 'v1';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function gitLastModified(absPath) {
  try {
    const rel = absPath.replace(REPO_ROOT + '/', '');
    // execFileSync with an argv array — never interpreted by a shell,
    // so a docs filename containing shell metacharacters cannot inject
    // commands (caught by Phase 4 backend audit).
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%cs', '--', rel],
      {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    )
      .toString()
      .trim();
    if (out && /^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    // git log can fail for untracked files; fall through.
  }
  return todayIso();
}

function walkMdx(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walkMdx(full, acc);
    else if (name.endsWith('.mdx')) acc.push(full);
  }
  return acc;
}

/**
 * Insert keys into an existing frontmatter block when missing. Lines
 * are appended just before the closing `---` so they stay grouped.
 * If the file has no frontmatter we don't add any — that would break
 * the per-route page.tsx wrapper which destructures `frontmatter`
 * from the module export.
 *
 * Returns the new content (idempotent: unchanged when nothing to do).
 */
function ensureKeys(content, { updated, apiVersion }) {
  const fmMatch = content.match(/^(﻿)?(---\r?\n)([\s\S]*?\n)(---\r?\n)/);
  if (!fmMatch) return content;
  const [full, bom = '', open, body, close] = fmMatch;
  let nextBody = body;
  if (!/^updated:\s/m.test(body)) {
    nextBody = nextBody.replace(/\n?$/, `\nupdated: ${updated}\n`);
  }
  if (!/^apiVersion:\s/m.test(nextBody)) {
    nextBody = nextBody.replace(/\n?$/, `\napiVersion: ${apiVersion}\n`);
  }
  if (nextBody === body) return content; // already migrated
  // Normalize the body so we don't accumulate trailing newlines on
  // re-runs.
  nextBody = nextBody.replace(/\n+$/, '\n');
  return content.replace(full, `${bom}${open}${nextBody}${close}`);
}

const files = walkMdx(DOCS_ROOT);
let added = 0;
let untouched = 0;
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const next = ensureKeys(content, {
    updated: gitLastModified(file),
    apiVersion: DEFAULT_API_VERSION,
  });
  if (next === content) {
    untouched += 1;
  } else {
    writeFileSync(file, next);
    added += 1;
  }
}
console.log(
  `[migrate-frontmatter] added ${added}, untouched ${untouched}, total ${files.length}`,
);

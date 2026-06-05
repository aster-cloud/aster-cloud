#!/usr/bin/env node
/**
 * Build-time docs search index. Walks every MDX file under
 * `src/app/[locale]/docs`, extracts the page slug, frontmatter
 * title/description, and H2/H3 headings, then writes per-locale JSON
 * to `src/lib/docs/search-index.<locale>.json`.
 *
 * The runtime command palette dynamically imports the matching locale
 * file when the user opens search — keeps the initial docs route
 * bundle clean (palette UI loads, index waits for actual use).
 *
 * Hard budget (per Phase 5 plan): gzip output ≤ 25KB per locale. If
 * a future expansion blows the cap, the build fails — we'd rather
 * force a trim than ship a slow first paint.
 *
 * Output schema:
 *   {
 *     locale: 'en' | 'zh' | 'de',
 *     entries: [
 *       {
 *         slug: 'api/policies/evaluate',
 *         title: 'Evaluate Policy',
 *         description: 'Evaluate a deployed policy by …',
 *         headings: ['Required Role', 'Request Body', …],
 *       },
 *       …
 *     ],
 *   }
 *
 * Idempotent: re-runs are safe. The script wins both the runtime
 * data and the build-cache footprint.
 */

import { gzipSync } from 'node:zlib';
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DOCS_ROOT = resolve(REPO_ROOT, 'src/app/[locale]/docs');
const OUTPUT_DIR = resolve(REPO_ROOT, 'src/lib/docs');
const LOCALES = ['en', 'zh', 'de'];
const GZIP_BUDGET_BYTES = 25 * 1024;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else if (name.endsWith('.mdx')) acc.push(full);
  }
  return acc;
}

/**
 * Pull `title:` / `description:` out of YAML frontmatter. Quoted and
 * unquoted forms are both accepted; multi-line values are not (docs
 * frontmatter convention keeps these single-line).
 */
function parseFrontmatter(content) {
  const m = content.match(/^(﻿)?---\r?\n([\s\S]*?)\n---\r?\n/);
  if (!m) return { title: '', description: '' };
  const body = m[2];
  const title = extractKey(body, 'title');
  const description = extractKey(body, 'description');
  return { title, description };
}

function extractKey(body, key) {
  // Double-quoted values may contain YAML escapes (\" and \\) — e.g. a
  // description whose first sentence has a quote. The capture `[^"\n]*`
  // stops at the first inner quote, so we instead match a quoted scalar that
  // allows escaped chars, then unescape, keeping this reader consistent with
  // the YAML-escaped values inject-descriptions.mjs writes.
  const dq = body.match(new RegExp(`^${key}:\\s*"((?:[^"\\\\\\n]|\\\\.)*)"\\s*$`, 'm'));
  if (dq) return dq[1].replace(/\\(["\\])/g, '$1').trim();
  const sq = body.match(new RegExp(`^${key}:\\s*'([^'\\n]*)'\\s*$`, 'm'));
  if (sq) return sq[1].trim();
  const plain = body.match(new RegExp(`^${key}:\\s*([^\\n]*)\\s*$`, 'm'));
  return plain ? plain[1].trim() : '';
}

/**
 * Strip the frontmatter block and return only the article body so
 * heading detection doesn't include `title:` etc.
 */
function stripFrontmatter(content) {
  return content.replace(/^(﻿)?---\r?\n[\s\S]*?\n---\r?\n/, '');
}

/**
 * Pull H2 + H3 headings out of the article body. We skip H1 (the
 * page title duplicates the frontmatter title) and anything inside
 * fenced code blocks. The order is preserved.
 */
function parseHeadings(body) {
  const lines = body.split(/\r?\n/);
  const headings = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    const text = (h2?.[1] ?? h3?.[1] ?? '').trim();
    if (text) headings.push(text);
  }
  return headings;
}

/**
 * Convert a filesystem path to the slug used by the rest of the
 * docs (e.g. `src/app/[locale]/docs/api/policies/evaluate/en.mdx`
 * → `api/policies/evaluate`).
 */
function fileToSlug(absPath) {
  const rel = absPath.slice(DOCS_ROOT.length + 1); // drop leading /
  const parts = rel.split('/');
  parts.pop(); // drop `<locale>.mdx`
  return parts.join('/');
}

function buildIndexForLocale(locale, mdxFiles) {
  const entries = [];
  const seen = new Set();
  for (const file of mdxFiles) {
    if (!file.endsWith(`/${locale}.mdx`)) continue;
    const slug = fileToSlug(file);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const content = readFileSync(file, 'utf8');
    const { title, description } = parseFrontmatter(content);
    const headings = parseHeadings(stripFrontmatter(content));
    if (!title && headings.length === 0) continue; // empty page
    entries.push({ slug, title, description, headings });
  }
  // Stable order — slug alphabetical — keeps index diffs small.
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return { locale, entries };
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const mdxFiles = walk(DOCS_ROOT);
ensureDir(OUTPUT_DIR);

let total = 0;
let exceeded = false;
for (const locale of LOCALES) {
  const index = buildIndexForLocale(locale, mdxFiles);
  const json = JSON.stringify(index);
  const gzipped = gzipSync(json).length;
  const path = join(OUTPUT_DIR, `search-index.${locale}.json`);
  writeFileSync(path, json);
  console.log(
    `[build-docs-index] ${locale}: ${index.entries.length} entries, ` +
      `${json.length}B raw / ${gzipped}B gzip`,
  );
  total += index.entries.length;
  if (gzipped > GZIP_BUDGET_BYTES) {
    console.error(
      `[build-docs-index] FAIL — ${locale} index exceeds ${GZIP_BUDGET_BYTES}B gzip budget`,
    );
    exceeded = true;
  }
}

if (exceeded) {
  process.exit(1);
}
console.log(`[build-docs-index] OK — ${LOCALES.length} locales, ${total} total entries`);

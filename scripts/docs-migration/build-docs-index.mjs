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
  lstatSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DOCS_ROOT = resolve(REPO_ROOT, 'src/app/[locale]/docs');
const OUTPUT_DIR = resolve(REPO_ROOT, 'src/lib/docs');
const LOCALES = ['en', 'zh', 'de'];
const GZIP_BUDGET_BYTES = 25 * 1024;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    // lstat (not stat) so symlinks are not followed — consistent with
    // inject-descriptions.mjs; avoids symlink-cycle runaway recursion.
    const s = lstatSync(full);
    if (s.isSymbolicLink()) continue;
    if (s.isDirectory()) walk(full, acc);
    else if (name.endsWith('.mdx')) acc.push(full);
  }
  return acc;
}

/**
 * Pull `title:` / `description:` out of YAML frontmatter with a real YAML
 * parser (single source of truth shared with inject-descriptions.mjs's
 * guard). Using the actual parser — not a regex — means block/folded
 * scalars and YAML escapes are read identically here and in the CI
 * non-empty check, so a description can never pass the guard yet land empty
 * or corrupted in the search index.
 */
export function parseFrontmatter(content) {
  const m = content.match(/^(﻿)?---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { title: '', description: '' };
  // 注意：YAML 解析错误**不吞**——抛出让调用方带文件路径报告并 fail。
  // 静默吞成空 metadata 会让 frontmatter 语法错误伪装成"内容缺失"，难排查。
  const obj = parseYaml(m[2]);
  if (!obj || typeof obj !== 'object') return { title: '', description: '' };
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return { title: str(obj.title), description: str(obj.description) };
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
    let title, description;
    try {
      ({ title, description } = parseFrontmatter(content));
    } catch (e) {
      // 带文件路径 fail：YAML 语法错误必须显式暴露，而不是退化成空 metadata。
      throw new Error(`[build-docs-index] invalid YAML frontmatter in ${file}: ${e.message}`);
    }
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

/**
 * Build all locale indexes. In --check mode, compare the freshly-built JSON
 * against what's committed on disk WITHOUT writing (a side-effect-free CI
 * gate); otherwise write the files. Returns process exit code.
 */
function main(checkOnly) {
  const mdxFiles = walk(DOCS_ROOT);
  if (!checkOnly) ensureDir(OUTPUT_DIR);

  let total = 0;
  let exceeded = false;
  const drifted = [];
  for (const locale of LOCALES) {
    const index = buildIndexForLocale(locale, mdxFiles);
    const json = JSON.stringify(index);
    const gzipped = gzipSync(json).length;
    const path = join(OUTPUT_DIR, `search-index.${locale}.json`);

    if (checkOnly) {
      const onDisk = existsSync(path) ? readFileSync(path, 'utf8') : '';
      if (onDisk !== json) drifted.push(locale);
    } else {
      writeFileSync(path, json);
    }

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

  if (checkOnly && drifted.length) {
    console.error(
      `[build-docs-index] ✗ search index out of date for: ${drifted.join(', ')}.\n` +
        `Run: pnpm docs:index:build  (and commit src/lib/docs/search-index.*.json)`,
    );
    return 1;
  }
  if (exceeded) return 1;
  console.log(
    `[build-docs-index] OK — ${LOCALES.length} locales, ${total} total entries` +
      (checkOnly ? ' (up to date)' : ''),
  );
  return 0;
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.includes('--check')));
}

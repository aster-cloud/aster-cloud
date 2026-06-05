#!/usr/bin/env node
/**
 * Inject a frontmatter `description:` into docs MDX files that lack one,
 * derived from the page's first prose paragraph.
 *
 * Why:
 *   - generateMetadata() in every docs page.tsx emits
 *     `<meta name="description">` from `fm.description`. Pages without it
 *     ship blank meta descriptions → poor SEO + empty social-share cards.
 *   - The opening paragraph of each MDX is already a concise, in-language
 *     summary of the endpoint/page, so it is the highest-quality source
 *     for a description without machine translation (zh.mdx yields a zh
 *     description, de.mdx a de one).
 *
 * Extraction rules (first paragraph after frontmatter that is real prose):
 *   - skip the frontmatter block, ATX headings (`#…`), blank lines, and
 *     leading JSX/components (`<Callout>`, `<Table>`, import lines, etc.).
 *   - collapse inline markdown (bold/italic/code/links) to plain text.
 *   - take whole sentences up to ~155 chars (meta-description sweet spot);
 *     never cut mid-word.
 *
 * Idempotent: files that already have `description:` are left untouched.
 * `--check` exits non-zero if any page is missing a description (CI guard).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const DOCS_ROOT = resolve(__dirname, '..', '..', 'src', 'app', '[locale]', 'docs');
const MAX_LEN = 155;
const CHECK_ONLY = process.argv.includes('--check');

/** Recursively collect every *.mdx under the docs tree. */
function findMdx(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findMdx(full));
    else if (name.endsWith('.mdx')) out.push(full);
  }
  return out;
}

/** True if the line is a non-prose construct we skip while hunting prose. */
function isSkippable(line) {
  const t = line.trim();
  if (t === '') return true;
  if (t.startsWith('#')) return true; // heading
  if (t.startsWith('<')) return true; // JSX / component / banner
  if (t.startsWith('import ') || t.startsWith('export ')) return true;
  if (t.startsWith('|')) return true; // table row
  if (t.startsWith('```')) return true; // code fence
  if (t.startsWith(':::')) return true; // admonition marker
  return false;
}

/** Collapse inline markdown to plain text for a clean meta description. */
function stripMarkdown(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/_([^_]+)_/g, '$1') // underscore italic
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Truncate to MAX_LEN preferring a sentence boundary, else a word boundary.
 * Keeps trailing punctuation natural; appends … only when mid-sentence cut.
 */
function truncate(text) {
  if (text.length <= MAX_LEN) return text;
  const window = text.slice(0, MAX_LEN);
  // Prefer ending at the last sentence terminator within the window.
  const lastStop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('。'),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  if (lastStop >= 80) return window.slice(0, lastStop + 1).trim();
  const lastSpace = window.lastIndexOf(' ');
  return (lastSpace >= 80 ? window.slice(0, lastSpace) : window).trim() + '…';
}

/** Extract the first prose paragraph (already stripped + truncated). */
function deriveDescription(body) {
  const lines = body.split('\n');
  let para = '';
  for (let i = 0; i < lines.length; i++) {
    if (isSkippable(lines[i])) {
      if (para) break; // paragraph ended
      continue;
    }
    para += (para ? ' ' : '') + lines[i].trim();
    // stop at a blank line right after we started collecting
    if (lines[i + 1] !== undefined && lines[i + 1].trim() === '') break;
  }
  const clean = stripMarkdown(para);
  return clean ? truncate(clean) : null;
}

/** Split a file into [frontmatterLines, bodyText]; null fm if absent. */
function splitFrontmatter(raw) {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return { fm: null, body: raw };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { fm: null, body: raw };
  return { fm: lines.slice(0, end + 1), fmEnd: end, body: lines.slice(end + 1).join('\n'), lines };
}

function escapeYaml(s) {
  // Double-quote and escape embedded quotes/backslashes for a YAML string.
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const files = findMdx(DOCS_ROOT).sort();
const missing = [];
let injected = 0;

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const { fm, fmEnd, body, lines } = splitFrontmatter(raw);
  if (!fm) {
    missing.push(`${file} (no frontmatter)`);
    continue;
  }
  if (fm.some((l) => /^description:/.test(l.trim()))) continue; // already present

  const desc = deriveDescription(body);
  if (!desc) {
    missing.push(`${file} (could not derive — no prose paragraph)`);
    continue;
  }

  if (CHECK_ONLY) {
    missing.push(file);
    continue;
  }

  // Insert `description:` right after the `title:` line (or after opening ---).
  const titleIdx = lines.findIndex(
    (l, i) => i > 0 && i < fmEnd && /^title:/.test(l.trim()),
  );
  const insertAt = titleIdx >= 0 ? titleIdx + 1 : 1;
  lines.splice(insertAt, 0, `description: ${escapeYaml(desc)}`);
  writeFileSync(file, lines.join('\n'), 'utf8');
  injected++;
  console.log(`  + ${file.replace(DOCS_ROOT, 'docs')}\n      ${desc}`);
}

if (CHECK_ONLY) {
  if (missing.length) {
    console.error(`\n✗ ${missing.length} docs MDX file(s) missing frontmatter description:`);
    for (const m of missing) console.error(`  - ${m.replace(DOCS_ROOT, 'docs')}`);
    console.error('\nRun: node scripts/docs-migration/inject-descriptions.mjs');
    process.exit(1);
  }
  console.log(`✓ all ${files.length} docs MDX files have a frontmatter description`);
} else {
  console.log(`\nInjected descriptions into ${injected} file(s); ${files.length} total scanned.`);
  if (missing.length) {
    console.warn(`\n⚠ ${missing.length} file(s) need manual attention:`);
    for (const m of missing) console.warn(`  - ${m.replace(DOCS_ROOT, 'docs')}`);
  }
}

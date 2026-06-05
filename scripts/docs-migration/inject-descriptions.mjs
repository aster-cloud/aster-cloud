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

import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const DOCS_ROOT = resolve(__dirname, '..', '..', 'src', 'app', '[locale]', 'docs');
const MAX_LEN = 155;
// Hard ceiling for the --check quality guard. Slightly above the 155 soft
// target used when deriving, so a manually-written description has a little
// headroom but can't grow unbounded (SERP/social truncation).
const MAX_DESC_LEN = 160;
const CHECK_ONLY = process.argv.includes('--check');

/** Recursively collect every *.mdx under the docs tree. */
function findMdx(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    // lstat (not stat) so symlinks are not followed — avoids any chance of a
    // symlink cycle making this recursion run away in CI.
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...findMdx(full));
    else if (name.endsWith('.mdx')) out.push(full);
  }
  return out;
}

/**
 * Parse the frontmatter block with a real YAML parser and return the
 * `description` value (or undefined). Used by the presence check so that
 * `description: ""`, `description:`, and `description: "   "` do NOT pass —
 * a regex-only check would accept those and let blank meta descriptions
 * regress silently.
 */
export function frontmatterDescription(fmLines) {
  try {
    // fmLines includes the surrounding `---`; drop them before YAML parse.
    const inner = fmLines.slice(1, fmLines.length - 1).join('\n');
    const obj = parseYaml(inner);
    const d = obj && typeof obj === 'object' ? obj.description : undefined;
    return typeof d === 'string' ? d : undefined;
  } catch {
    return undefined;
  }
}

/** True if the line is a non-prose construct we skip while hunting prose. */
export function isSkippable(line) {
  const t = line.trim();
  if (t === '') return true;
  if (t.startsWith('#')) return true; // heading
  if (t.startsWith('<')) return true; // JSX / component / banner
  if (t.startsWith('import ') || t.startsWith('export ')) return true;
  if (t.startsWith('|')) return true; // table row
  if (t.startsWith('```')) return true; // code fence
  if (t.startsWith(':::')) return true; // admonition marker
  if (t.startsWith('>')) return true; // blockquote
  if (/^[-*+]\s/.test(t)) return true; // unordered list item
  if (/^\d+\.\s/.test(t)) return true; // ordered list item
  return false;
}

/** Collapse inline markdown to plain text for a clean meta description. */
export function stripMarkdown(s) {
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
 * The final string (including any appended …) never exceeds MAX_LEN.
 */
export function truncate(text) {
  if (text.length <= MAX_LEN) return text;
  // Prefer ending at the last sentence terminator within the full window.
  const window = text.slice(0, MAX_LEN);
  const lastStop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('。'),
    window.lastIndexOf('！'),
    window.lastIndexOf('？'),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
  );
  if (lastStop >= 80) return window.slice(0, lastStop + 1).trim();
  // Mid-sentence cut: reserve one char for the … so total length ≤ MAX_LEN.
  const ellipsisWindow = text.slice(0, MAX_LEN - 1);
  const lastSpace = ellipsisWindow.lastIndexOf(' ');
  return (lastSpace >= 80 ? ellipsisWindow.slice(0, lastSpace) : ellipsisWindow).trim() + '…';
}

/**
 * Extract the first prose paragraph (stripped + truncated), using a small
 * state machine so we correctly skip non-prose blocks:
 *   - fenced code blocks (``` … ```): skip the whole fence, not just the
 *     opening line (otherwise code lines leak into the description).
 *   - leading JSX/component blocks (<Callout>…</Callout>): skip until the
 *     block's content is past; we only want article prose.
 *   - headings, lists, blockquotes, tables, import/export, admonitions.
 * Collection starts at the first real prose line and ends at the next blank
 * line or non-prose construct.
 */
export function deriveDescription(body) {
  const lines = body.split(/\r?\n/);
  let para = '';
  let inFence = false;
  let jsxDepth = 0; // >0 while inside a multi-line JSX component block
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    // Fenced code block toggling — skip everything between fences.
    if (t.startsWith('```')) {
      if (para) break; // a paragraph already ended before this fence
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // JSX/component block: a line opening a tag that isn't closed/self-closed
    // on the same line (e.g. "<Callout …>") starts a block whose *inner* prose
    // must NOT be collected. Track depth via open vs close tags until balanced.
    if (jsxDepth > 0) {
      jsxDepth += countJsxOpens(t) - countJsxCloses(t);
      continue;
    }
    if (t.startsWith('<')) {
      if (para) break;
      const delta = countJsxOpens(t) - countJsxCloses(t);
      if (delta > 0) jsxDepth += delta; // unbalanced → enter block
      continue; // single-line/self-closed tag: just skip this line
    }

    if (isSkippable(lines[i])) {
      if (para) break; // blank line / non-prose ends the paragraph
      continue;
    }

    para += (para ? ' ' : '') + t;
    // stop at a blank line right after we started collecting
    if (lines[i + 1] !== undefined && lines[i + 1].trim() === '') break;
  }
  const clean = stripMarkdown(para);
  return clean ? truncate(clean) : null;
}

/** Count opening JSX tags on a line: <Tag …> but not </Tag> nor <Tag … />. */
function countJsxOpens(line) {
  const m = line.match(/<[A-Za-z][^>]*>/g);
  if (!m) return 0;
  return m.filter((tag) => !tag.startsWith('</') && !tag.endsWith('/>')).length;
}

/** Count closing JSX tags on a line: </Tag> and self-closed <Tag …/>. */
function countJsxCloses(line) {
  const close = (line.match(/<\/[A-Za-z][^>]*>/g) || []).length;
  const selfClose = (line.match(/<[A-Za-z][^>]*\/>/g) || []).length;
  return close + selfClose;
}

/** Split a file into [frontmatterLines, bodyText]; null fm if absent. */
export function splitFrontmatter(raw) {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') return { fm: null, body: raw };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { fm: null, body: raw };
  return { fm: lines.slice(0, end + 1), fmEnd: end, body: lines.slice(end + 1).join('\n'), lines };
}

export function escapeYaml(s) {
  // Double-quote and escape embedded quotes/backslashes for a YAML string.
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * CLI entry: walk the docs tree, inject (or --check) descriptions.
 * Wrapped in a function + guarded below so importing this module for unit
 * tests does NOT trigger the file-system walk or process.exit.
 */
function main() {
  const files = findMdx(DOCS_ROOT).sort();
  const missing = [];
  const tooLong = [];
  let injected = 0;

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const { fm, fmEnd, body, lines } = splitFrontmatter(raw);
    if (!fm) {
      missing.push(`${file} (no frontmatter)`);
      continue;
    }
    // Non-empty check via real YAML parse: a present-but-blank description
    // (""/whitespace) must NOT count as satisfied, or the original blank-meta
    // regression slips back in.
    const existing = frontmatterDescription(fm);
    if (existing && existing.trim().length > 0) {
      // Quality guard: meta descriptions beyond ~MAX_DESC_LEN get truncated in
      // SERPs/social cards. Flag (don't auto-edit hand-written ones) so they
      // get shortened deliberately.
      if (CHECK_ONLY && existing.trim().length > MAX_DESC_LEN) {
        tooLong.push(`${file.replace(DOCS_ROOT, 'docs')} (${existing.trim().length} chars)`);
      }
      continue; // already has a real description
    }

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
    if (missing.length || tooLong.length) {
      if (missing.length) {
        console.error(`\n✗ ${missing.length} docs MDX file(s) missing frontmatter description:`);
        for (const m of missing) console.error(`  - ${m.replace(DOCS_ROOT, 'docs')}`);
        console.error('\nRun: node scripts/docs-migration/inject-descriptions.mjs');
      }
      if (tooLong.length) {
        console.error(`\n✗ ${tooLong.length} description(s) exceed ${MAX_DESC_LEN} chars (will be truncated in search results):`);
        for (const m of tooLong) console.error(`  - ${m}`);
        console.error('\nShorten them in the MDX frontmatter.');
      }
      process.exit(1);
    }
    console.log(`✓ all ${files.length} docs MDX files have a non-empty description ≤ ${MAX_DESC_LEN} chars`);
  } else {
    console.log(`\nInjected descriptions into ${injected} file(s); ${files.length} total scanned.`);
    if (missing.length) {
      console.warn(`\n⚠ ${missing.length} file(s) need manual attention:`);
      for (const m of missing) console.warn(`  - ${m.replace(DOCS_ROOT, 'docs')}`);
    }
  }
}

// Run only when executed directly (node …/inject-descriptions.mjs), not on import.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

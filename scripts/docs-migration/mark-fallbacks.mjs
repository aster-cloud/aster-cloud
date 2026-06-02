#!/usr/bin/env node
/**
 * Detect locale-fallback MDX files (zh.mdx / de.mdx that are byte-identical
 * to their sibling en.mdx) and inject `<TranslationFallbackBanner />` at the
 * top of the page body so readers know they are seeing EN source.
 *
 * Why content comparison vs frontmatter flag:
 *   - applyFallback in migrate.mjs literally copies en.mdx, so byte-identical
 *     is the most reliable signal.
 *   - Once a real translation lands, the files diverge naturally and the
 *     banner disappears next time this script runs.
 *
 * Idempotent: if the banner is already present, the file is left alone.
 * Re-run after every migrate.mjs pass.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DOCS_ROOT = resolve(REPO_ROOT, 'src/app/[locale]/docs');

const BANNER_MARKER = '<TranslationFallbackBanner />';

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else if (name === 'en.mdx') acc.push(dirname(full));
  }
  return acc;
}

/**
 * Insert the banner directly UNDER the page H1 (after the frontmatter
 * block). UX intent: users see the page title first, then the warning
 * about the locale fallback. If no H1 is present, fall back to placing
 * the banner right after frontmatter so it still appears at the top
 * of the article body.
 */
/**
 * Inject `fallback: true` into the YAML frontmatter so the page
 * wrapper can emit canonical → EN + noindex on fallback variants
 * (see generate-page-wrappers.mjs). Idempotent: returns the content
 * unchanged if `fallback:` is already present.
 */
function injectFallbackFlag(content) {
  const fmMatch = content.match(/^(﻿)?---\r?\n([\s\S]*?\n)---\r?\n/);
  if (!fmMatch) return content;
  const [full, bom = '', body] = fmMatch;
  if (/^fallback:\s*true/m.test(body)) return content;
  const newFm = `${bom}---\n${body}fallback: true\n---\n`;
  return newFm + content.slice(full.length);
}

function injectBanner(content) {
  if (content.includes(BANNER_MARKER)) return injectFallbackFlag(content);
  // Tolerate BOM + both LF/CRLF in the frontmatter delimiters.
  const fmMatch = content.match(/^(﻿)?---\r?\n[\s\S]*?\n---\r?\n/);
  const afterFm = fmMatch ? fmMatch[0].length : 0;

  // Scan for the first H1 after frontmatter (markdown `# ` line).
  const tail = content.slice(afterFm);
  const h1Match = tail.match(/^(#\s[^\n]+)\n/m);
  let withBanner;
  if (h1Match) {
    const h1End = afterFm + (h1Match.index ?? 0) + h1Match[0].length;
    withBanner =
      content.slice(0, h1End) + '\n' + BANNER_MARKER + '\n' + content.slice(h1End);
  } else if (afterFm > 0) {
    // No H1 — insert right after frontmatter as a fallback.
    withBanner =
      content.slice(0, afterFm) + '\n' + BANNER_MARKER + '\n' + content.slice(afterFm);
  } else {
    // No frontmatter at all (shouldn't happen in our docs, but handle anyway).
    withBanner = BANNER_MARKER + '\n\n' + content;
  }
  return injectFallbackFlag(withBanner);
}

/**
 * Strip BOM, the banner marker (with surrounding whitespace), and
 * collapse runs of blank lines so we can compare the locale file's
 * "essential content" against EN. Idempotent — used on every run
 * before the equality check, so re-running on already-banner'd files
 * still classifies them as fallbacks.
 *
 * Why collapsing blank lines matters: when the banner is removed
 * from above-H1, a residual blank line may persist. After H1 placement
 * the same line is consumed by the post-H1 newline. Normalizing
 * absorbs both shapes.
 */
function essentialContent(content) {
  return content
    .replace(/^﻿/, '')
    .replace(new RegExp(`\\n?${BANNER_MARKER}\\n?`), '')
    // Strip the `fallback: true` flag so re-running on already-marked
    // files compares the body-content essence only.
    .replace(/^fallback:\s*true\s*\n/m, '')
    // Normalize locale-prefixed internal links so a file that
    // differs from EN only by `(/zh/docs/...)` vs `(/docs/...)` is
    // still detected as a fallback. `applyFallback` in migrate.mjs
    // rewrites these prefixes when copying EN content into zh/de
    // slots, so the prefix divergence is structural — not actual
    // translation.
    .replace(/\]\(\/(?:en|zh|de)\/docs\//g, '](/docs/')
    .replace(/\n{3,}/g, '\n\n');
}

const routeDirs = walk(DOCS_ROOT);
let marked = 0;
let alreadyMarked = 0;
let realTranslations = 0;
for (const dir of routeDirs) {
  const enPath = join(dir, 'en.mdx');
  const enContent = essentialContent(readFileSync(enPath, 'utf8'));
  for (const loc of ['zh', 'de']) {
    const locPath = join(dir, `${loc}.mdx`);
    let locContent;
    try {
      locContent = readFileSync(locPath, 'utf8');
    } catch {
      continue;
    }
    const locEssential = essentialContent(locContent);
    // Compare locale content against EN AFTER stripping the banner from
    // both sides so a re-run on already-banner'd files still detects
    // them as fallbacks rather than alternating banner on/off.
    if (locEssential === enContent) {
      // Locale is a fallback. Run injectBanner unconditionally — it's
      // idempotent for the marker itself but will add the
      // `fallback: true` frontmatter flag on files that previously had
      // the banner but predate the flag.
      const updated = injectBanner(locContent);
      if (updated === locContent) {
        alreadyMarked += 1;
      } else if (locContent.includes(BANNER_MARKER)) {
        // Already banner-marked but flag was missing — silent upgrade.
        writeFileSync(locPath, updated);
        alreadyMarked += 1;
      } else {
        writeFileSync(locPath, updated);
        marked += 1;
      }
    } else if (locContent.includes(BANNER_MARKER)) {
      // Real translation arrived but the leftover banner is now stale.
      writeFileSync(locPath, essentialContent(locContent));
      realTranslations += 1;
    } else {
      realTranslations += 1;
    }
  }
}
console.log(
  `[mark-fallbacks] marked ${marked}, already-marked ${alreadyMarked}, real translations ${realTranslations}`,
);

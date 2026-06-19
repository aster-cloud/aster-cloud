/**
 * check-locale-coverage.mjs  (GitHub #98)
 *
 * Reports, per locale, how many *leaf* translation keys are actually present
 * (non-empty) vs the `en` backbone — i.e. real translation coverage, not just
 * "the file parses". Complements scripts/check-locales.ts (which enforces
 * structural parity for the fully-translated locales) by giving a quick
 * percentage view that includes partial locales like `hi`.
 *
 * Why this exists: `hi.json` shipped ~7% complete while listed as a first-class
 * locale. The deep-merge fallback in src/i18n/request.ts prevents crashes (missing
 * keys fall back to en), but users silently see English. This script surfaces the
 * gap and can fail CI under a configurable threshold once product decides a bar.
 *
 * A leaf is "covered" when the locale has a non-empty, non-whitespace string at
 * the same path as the backbone (mirrors deepMergeMessages' emptiness rule).
 *
 * Usage:
 *   node scripts/check-locale-coverage.mjs                 # report only, exit 0
 *   node scripts/check-locale-coverage.mjs --min=80        # fail if any < 80%
 *   node scripts/check-locale-coverage.mjs --min=80 --only=zh,de
 *
 * Exit codes:
 *   0 = report printed (and, with --min, all checked locales meet the bar)
 *   1 = a checked locale fell below --min, or a file failed to load
 *
 * NOTE: intentionally NOT wired as a blocking CI gate by default — coverage
 * thresholds are a product decision (see issue #98). Wired as `check:locale-coverage`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const BACKBONE = 'en';
const ALL_LOCALES = ['zh', 'de', 'hi'];

// UI 文案真相源 = @aster-cloud/ui-messages(en/zh/de) + @aster-cloud/ui-messages-hi(hi)
// npm 包。cloud 不再手维护 messages/*（单一真相源，ADR 0018）。短码 → 包 + 全码 id。
const LOCALE_PACKAGE = {
  en: { pkg: '@aster-cloud/ui-messages', id: 'en-US' },
  zh: { pkg: '@aster-cloud/ui-messages', id: 'zh-CN' },
  de: { pkg: '@aster-cloud/ui-messages', id: 'de-DE' },
  hi: { pkg: '@aster-cloud/ui-messages-hi', id: 'hi-IN' },
};

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function load(code) {
  const entry = LOCALE_PACKAGE[code];
  if (!entry) throw new Error(`unknown locale: ${code}`);
  const file = join(PROJECT_ROOT, 'node_modules', entry.pkg, `${entry.id}.json`);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/** Collect every leaf path (dot-joined) under a message tree. */
function leafPaths(tree, prefix, out) {
  for (const key of Object.keys(tree)) {
    const v = tree[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      leafPaths(v, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

/** Read the value at a dot path; undefined if any segment is missing. */
function valueAt(tree, path) {
  let cur = tree;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function isCovered(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function main() {
  const min = arg('min') !== undefined ? Number(arg('min')) : undefined;
  const only = arg('only');
  const locales = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : ALL_LOCALES;

  let backbone;
  try {
    backbone = load(BACKBONE);
  } catch (e) {
    console.error(`✗ failed to load backbone messages/${BACKBONE}.json: ${e.message}`);
    process.exit(1);
  }
  const backbonePaths = leafPaths(backbone, '', []);
  const total = backbonePaths.length;

  let failed = false;
  console.log(`Locale coverage vs '${BACKBONE}' backbone (${total} leaf keys):\n`);

  for (const code of locales) {
    let tree;
    try {
      tree = load(code);
    } catch (e) {
      console.error(`✗ [${code}] failed to load: ${e.message}`);
      failed = true;
      continue;
    }
    let covered = 0;
    for (const p of backbonePaths) {
      if (isCovered(valueAt(tree, p))) covered += 1;
    }
    const pct = total === 0 ? 100 : (covered / total) * 100;
    const pctStr = pct.toFixed(1).padStart(5);
    const flag = min !== undefined && pct < min ? ' ✗ below threshold' : '';
    if (min !== undefined && pct < min) failed = true;
    console.log(`  ${code}: ${pctStr}%  (${covered}/${total})${flag}`);
  }

  if (min !== undefined) {
    console.log(`\nThreshold: ${min}%`);
  }
  process.exit(failed ? 1 : 0);
}

main();

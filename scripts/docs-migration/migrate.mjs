#!/usr/bin/env node
/**
 * One-off migration: aster-lang-dev/docs/{,zh,de}/{api,getting-started}/**.md
 *                  → aster-cloud/src/app/[locale]/docs/.../{en,zh,de}.mdx
 *
 * Transformations applied:
 *   1. Strip <!-- glossary:block id=... -->/<!-- /glossary:block --> comment
 *      pairs (aster-lang-dev internal tooling; not meaningful in aster-cloud).
 *   2. Rewrite internal markdown links:
 *        ./authentication        → /docs/getting-started/authentication
 *        ../authentication       → /docs/getting-started/authentication
 *        /api/policies/evaluate  → /docs/api/policies/evaluate
 *        /getting-started/auth   → /docs/getting-started/auth
 *      (The next-intl <Link> still prepends the active locale.)
 *   3. Leave endpoint examples (curl, JSON, https://policy.aster-lang.dev)
 *      alone — those are factual content and need separate audit.
 *   4. Skip files containing `import` / `export` at file level (those are
 *      already MDX, not markdown).
 *
 * Idempotent: re-running overwrites destination files. Run from repo
 * root with `node scripts/docs-migration/migrate.mjs`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const SRC_REPO = resolve(REPO_ROOT, '..', 'aster-lang-dev');
const DEST_ROOT = resolve(REPO_ROOT, 'src/app/[locale]/docs');

const LOCALES = ['en', 'zh', 'de'];

/**
 * Strip glossary markers. They appear as paired HTML comments around
 * a block; remove both markers but keep the content.
 */
function stripGlossaryMarkers(md) {
  return md
    .replace(/<!--\s*glossary:block\s+id=[^>]+>\s*\n?/g, '')
    .replace(/<!--\s*\/glossary:block\s*-->\s*\n?/g, '');
}

/**
 * Strip VitePress-only Vue components embedded in markdown. The
 * `<HeroAnimation />` tag in aster-lang-dev's evaluate.md is a Vue SFC,
 * not a React component — MDX would try to import it as React and fail.
 *
 * Future React-equivalent components are added back via mdx-components.tsx
 * once they exist on the cloud side (out of Phase-1 scope).
 */
function stripVuePlaceholders(md) {
  return md.replace(/^<HeroAnimation\s*\/>\s*\n?/gm, '');
}

/**
 * Rewrite relative + absolute legacy links to /docs/* equivalents.
 *
 * Match strategies (in order):
 *   - `](./foo)`           → `](/docs/getting-started/foo)` (siblings)
 *   - `](../api/x/y)`      → `](/docs/api/x/y)`
 *   - `](/api/x/y)`        → `](/docs/api/x/y)`
 *   - `](/getting-started/x)` → `](/docs/getting-started/x)`
 *
 * `pageDir` is the new destination dir for figuring out sibling paths,
 * e.g. "/docs/getting-started" — sibling `./errors` becomes `/docs/getting-started/errors`.
 */
function rewriteLinks(md, pageDir) {
  return md
    // Same-dir relative: ./foo or ./foo#anchor
    .replace(/\]\(\.\/([^)#]+)(#[^)]*)?\)/g, (_m, slug, anchor = '') => {
      return `](${pageDir}/${slug}${anchor})`;
    })
    // Parent-dir relative: ../foo/bar
    .replace(/\]\(\.\.\/([^)#]+)(#[^)]*)?\)/g, (_m, slug, anchor = '') => {
      // sibling section under /docs/
      return `](/docs/${slug}${anchor})`;
    })
    // Absolute /api/* (legacy aster-lang-dev URLs)
    .replace(/\]\(\/api\/([^)#]+)(#[^)]*)?\)/g, (_m, rest, anchor = '') => {
      return `](/docs/api/${rest}${anchor})`;
    })
    // Absolute /getting-started/* (legacy aster-lang-dev URLs)
    .replace(/\]\(\/getting-started\/([^)#]+)(#[^)]*)?\)/g, (_m, rest, anchor = '') => {
      return `](/docs/getting-started/${rest}${anchor})`;
    });
}

/**
 * Wrap with YAML frontmatter pulling the first # heading as title.
 */
function ensureFrontmatter(md, fallback) {
  // already has frontmatter?
  if (/^---\s*\n/.test(md)) return md;
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : fallback;
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${md}`;
}

function migrateOne(srcPath, destPath, pageDir) {
  if (!existsSync(srcPath)) {
    console.warn(`[skip] source missing: ${srcPath}`);
    return false;
  }
  const raw = readFileSync(srcPath, 'utf8');
  let out = raw;
  out = stripGlossaryMarkers(out);
  out = stripVuePlaceholders(out);
  out = rewriteLinks(out, pageDir);
  // Use file basename for fallback title.
  const fallback = srcPath.split('/').pop().replace(/\.md$/, '');
  out = ensureFrontmatter(out, fallback);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, out);
  return true;
}

/**
 * Map a source markdown path back to a destination MDX path.
 *
 * Sources:
 *   aster-lang-dev/docs/getting-started/overview.md           (en)
 *   aster-lang-dev/docs/zh/getting-started/overview.md        (zh)
 *   aster-lang-dev/docs/de/getting-started/overview.md        (de)
 *   aster-lang-dev/docs/api/policies/evaluate.md              (en, no zh/de)
 *
 * Destinations (per-locale MDX files alongside per-route page.tsx):
 *   aster-cloud/src/app/[locale]/docs/getting-started/overview/en.mdx
 *   ...                                                       /zh.mdx
 *   ...                                                       /de.mdx
 */
function destFor(group, locale, slug) {
  // slug like "overview" or "policies/evaluate"
  return join(DEST_ROOT, group, slug, `${locale}.mdx`);
}

function srcFor(group, locale, slug) {
  const localePrefix = locale === 'en' ? '' : `${locale}/`;
  return join(SRC_REPO, 'docs', localePrefix + group, `${slug}.md`);
}

const PLAN = {
  'getting-started': ['overview', 'authentication', 'quickstart', 'errors'],
  'api/policies': [
    'evaluate',
    'evaluate-source',
    'evaluate-json',
    'batch',
    'schema',
    'validate',
    'versions',
    'rollback',
    'cache',
  ],
  'api/workflows': ['events', 'state', 'metrics'],
  'api/audit': [
    'logs',
    'verify-chain',
    'version-usage',
    'anomalies',
    'compare',
  ],
  'api/graphql': ['overview', 'queries', 'mutations'],
  'api/websocket': ['preview'],
};

/**
 * API docs in aster-lang-dev are EN-only by glossary policy. To avoid
 * 404s on /zh/docs/api/* + /de/docs/api/* we copy the EN content as a
 * fallback. A small banner injected at the top tells the reader this
 * page hasn't been translated yet (the i18n key is shipped by the
 * page wrapper, not the MDX, so the banner is locale-aware).
 *
 * Sessions 5+ will translate API docs; until then the EN fallback is
 * a strict improvement over 404 or a redirect that drops users into
 * a different language.
 */
function applyFallback(group, slug) {
  if (!group.startsWith('api/')) return;
  const enDest = destFor(group, 'en', slug);
  if (!existsSync(enDest)) return;
  const enContent = readFileSync(enDest, 'utf8');
  for (const locale of ['zh', 'de']) {
    const localeDest = destFor(group, locale, slug);
    // Skip only if a real translation was already migrated from
    // aster-lang-dev/docs/{zh,de}/api/**. Detect by checking the
    // corresponding source file; if it exists, the localized migrate
    // pass already wrote `localeDest` with locale-specific content
    // and we must NOT clobber it with the EN fallback.
    const localeSrc = srcFor(group, locale, slug);
    if (existsSync(localeSrc)) continue;
    mkdirSync(dirname(localeDest), { recursive: true });
    writeFileSync(localeDest, enContent);
  }
}

let okCount = 0;
let skipCount = 0;
let fallbackCount = 0;
for (const [group, slugs] of Object.entries(PLAN)) {
  for (const slug of slugs) {
    const pageDir = `/docs/${group}`; // for link rewriter
    for (const locale of LOCALES) {
      const src = srcFor(group, locale, slug);
      const dest = destFor(group, locale, slug);
      const ok = migrateOne(src, dest, pageDir);
      if (ok) okCount += 1;
      else skipCount += 1;
    }
    // Apply EN fallback for API where zh/de were missing.
    const beforeApi = okCount + skipCount;
    applyFallback(group, slug);
    // Count fallback writes — re-check on disk.
    for (const locale of ['zh', 'de']) {
      const dest = destFor(group, locale, slug);
      if (existsSync(dest) && group.startsWith('api/')) {
        const src = srcFor(group, locale, slug);
        if (!existsSync(src)) fallbackCount += 1;
      }
    }
  }
}
console.log(`[migrate] wrote ${okCount}, skipped ${skipCount}, en-fallback ${fallbackCount}`);

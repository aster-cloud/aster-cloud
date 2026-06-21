import type { MetadataRoute } from 'next';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { locales, defaultLocale } from '@/i18n/config';

/**
 * Site-wide sitemap generator.
 *
 * Includes:
 *   - All docs subsite routes × 3 locales with proper `alternates.languages`
 *     so search engines understand the cross-locale equivalence.
 *   - Public marketing pages (/, /pricing, /privacy, /terms, /equivalence)
 *     × 3 locales.
 *
 * Excludes:
 *   - Dashboard, auth, API routes (not public; require login).
 *
 * URL shape follows `localePrefix: 'as-needed'` (src/i18n/navigation.ts:8):
 *   default locale (en) → bare /path
 *   zh/de → /zh/path, /de/path
 *
 * Cloudflare Workers cannot fs.readFile at request time, so this runs
 * at build (Next.js evaluates app/sitemap.ts during `next build` and
 * caches the result for the lifetime of the deploy).
 */

const SITE_URL = 'https://aster-lang.cloud';

function localizedUrl(slug: string, locale: string): string {
  const prefix = locale === defaultLocale ? '' : `/${locale}`;
  return `${SITE_URL}${prefix}${slug}`;
}

function alternatesFor(slug: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const loc of locales) {
    out[loc] = localizedUrl(slug, loc);
  }
  out['x-default'] = localizedUrl(slug, defaultLocale);
  return out;
}

/**
 * Walk `src/app/[locale]/docs/` to find every route (a directory
 * containing en.mdx). Returns slugs like `/docs/api/policies/evaluate`.
 *
 * We resolve the docs root from process.cwd() — Next runs the
 * generator inside the project root during build.
 */
function enumerateDocsRoutes(): string[] {
  const docsRoot = resolve(process.cwd(), 'src/app/[locale]/docs');
  const slugs: string[] = [];

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    let hasEn = false;
    for (const name of entries) {
      const full = join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (name === 'en.mdx') hasEn = true;
    }
    if (hasEn) {
      const rel = dir.slice(docsRoot.length); // "/api/policies/evaluate" or ""
      slugs.push('/docs' + rel);
    }
  }
  walk(docsRoot);
  return slugs.sort();
}

const PUBLIC_MARKETING_SLUGS = [
  '/',
  '/pricing',
  '/privacy',
  '/terms',
  '/equivalence',
  '/demos',
];

/**
 * Push one entry per (slug × locale). Each entry carries reciprocal
 * hreflang alternates so search engines can pick the right variant
 * regardless of which `<loc>` they crawl first.
 *
 * Note: one-entry-per-locale (instead of one default-locale entry with
 * alternates) is what Google's own multilingual sitemap guidance
 * recommends — it makes localized URLs first-class crawl candidates.
 */
function pushLocaleVariants(
  entries: MetadataRoute.Sitemap,
  slug: string,
  base: { lastModified: Date; changeFrequency: 'weekly' | 'monthly'; priority: number },
) {
  const alternates = { languages: alternatesFor(slug) };
  for (const loc of locales) {
    entries.push({
      url: localizedUrl(slug, loc),
      ...base,
      alternates,
    });
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const slug of PUBLIC_MARKETING_SLUGS) {
    pushLocaleVariants(entries, slug, {
      lastModified: now,
      changeFrequency: 'weekly',
      priority: slug === '/' ? 1.0 : 0.7,
    });
  }

  for (const slug of enumerateDocsRoutes()) {
    pushLocaleVariants(entries, slug, {
      lastModified: now,
      changeFrequency: 'monthly',
      priority: slug === '/docs' ? 0.9 : 0.6,
    });
  }

  return entries;
}

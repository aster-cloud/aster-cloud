import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { docsSidebar } from '@/lib/docs/sidebar';

/**
 * Guard: every generated page.tsx wrapper's ROUTE_SLUG constant must
 * match the directory path it lives in, and the sidebar's href must
 * resolve to a real directory. Catches drift between three sources of
 * truth: sidebar.ts, fs directory structure, and the canonical URL
 * baked into each wrapper at generate-time.
 *
 * If this test fails after a refactor, re-run
 *   node scripts/docs-migration/generate-page-wrappers.mjs
 * and double-check sidebar.ts hrefs against fs paths.
 */

const DOCS_ROOT = resolve(__dirname, '../../src/app/[locale]/docs');

function listEnRoutes(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (name === 'en.mdx') {
        const rel = dirname(full).slice(DOCS_ROOT.length);
        out.push('/docs' + rel); // e.g. /docs/api/policies/evaluate
      }
    }
  }
  walk(DOCS_ROOT);
  return out.sort();
}

describe('docs route consistency', () => {
  const routes = listEnRoutes();

  it('finds at least 20 routes (sanity check)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(20);
  });

  it('every page.tsx ROUTE_SLUG matches its own filesystem path', () => {
    const errors: string[] = [];
    for (const route of routes) {
      // Resolve back to the page.tsx path.
      const dirRel = route.replace(/^\/docs/, '');
      const pagePath = join(DOCS_ROOT, dirRel, 'page.tsx');
      const content = readFileSync(pagePath, 'utf8');
      const m = content.match(/const ROUTE_SLUG = '([^']+)'/);
      if (!m) {
        errors.push(`${pagePath} has no ROUTE_SLUG constant`);
        continue;
      }
      if (m[1] !== route) {
        errors.push(`${pagePath} ROUTE_SLUG="${m[1]}" but fs path is "${route}"`);
      }
    }
    if (errors.length) throw new Error('Drift detected:\n' + errors.join('\n'));
  });

  it('every sidebar href resolves to a real route', () => {
    const fsSet = new Set(routes);
    const errors: string[] = [];
    for (const section of docsSidebar) {
      for (const item of section.items) {
        const expected = `/docs/${item.href}`;
        if (!fsSet.has(expected)) {
          errors.push(
            `sidebar section ${section.titleKey} → ${item.labelKey} points at ${expected} but no en.mdx exists there`,
          );
        }
      }
    }
    if (errors.length) throw new Error('Sidebar drift:\n' + errors.join('\n'));
  });
});

/**
 * Schema + budget invariants for the committed docs search indexes.
 *
 * The index files are produced by
 * `scripts/docs-migration/build-docs-index.mjs` and are the runtime
 * data source the docs Cmd+K palette dynamically imports per locale.
 * Tests here pin three guarantees so a future builder change can't
 * silently degrade the runtime:
 *   1. Each shipped index satisfies the runtime's expected shape
 *      (locale + entries[] with slug/title/description/headings).
 *   2. The committed gzip size is within the per-locale budget that
 *      the builder also enforces (25KB) — guards against committing
 *      a fresh index that was generated with a smaller corpus and
 *      slipped past CI.
 *   3. No raw email-shaped string leaked into title / description /
 *      heading fields. The build-time PII scan covers HTML output,
 *      but the index is JSON consumed by a different code path.
 */

import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import enIndex from '@/lib/docs/search-index.en.json';
import zhIndex from '@/lib/docs/search-index.zh.json';
import deIndex from '@/lib/docs/search-index.de.json';
import type { SearchIndex } from '@/lib/docs/search-runtime';

const GZIP_BUDGET = 25 * 1024;
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}\b/;
const SAFE_EMAIL_DOMAINS = ['example.com', 'acme.com', 'acme-corp.com'];

function isSafeEmail(s: string): boolean {
  const m = s.match(EMAIL_RE);
  if (!m) return true;
  const domain = m[0].split('@')[1]?.toLowerCase() ?? '';
  return SAFE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

const indexes: { locale: string; data: SearchIndex }[] = [
  { locale: 'en', data: enIndex as SearchIndex },
  { locale: 'zh', data: zhIndex as SearchIndex },
  { locale: 'de', data: deIndex as SearchIndex },
];

describe('docs search index — shape + budget', () => {
  for (const { locale, data } of indexes) {
    describe(`${locale}`, () => {
      it('reports its own locale', () => {
        expect(data.locale).toBe(locale);
      });

      it('has at least one entry', () => {
        expect(data.entries.length).toBeGreaterThan(0);
      });

      it('every entry has slug + (title or headings)', () => {
        for (const entry of data.entries) {
          expect(typeof entry.slug).toBe('string');
          expect(entry.slug.length).toBeGreaterThan(0);
          expect(typeof entry.title).toBe('string');
          expect(Array.isArray(entry.headings)).toBe(true);
        }
      });

      it('committed gzip size fits the 25KB budget', () => {
        const gz = gzipSync(JSON.stringify(data)).length;
        expect(gz).toBeLessThan(GZIP_BUDGET);
      });

      it('contains no email-like literals outside known sample domains', () => {
        for (const entry of data.entries) {
          for (const field of [entry.title, entry.description, ...entry.headings]) {
            expect(isSafeEmail(field), `${entry.slug} field: ${field}`).toBe(true);
          }
        }
      });
    });
  }
});

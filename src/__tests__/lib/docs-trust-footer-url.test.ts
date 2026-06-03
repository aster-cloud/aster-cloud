/**
 * Behavioural coverage for the pure helpers exported from
 * DocsTrustFooter — `buildSuggestEditUrl` and `formatDate`.
 *
 * The helpers ship with the component module so we import the
 * production implementation directly (no duplication, no drift).
 * Component-level interactions (session probe gating, conditional
 * row rendering) are exercised by E2E.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSuggestEditUrl,
  formatDate,
} from '@/lib/docs/trust-footer-helpers';

describe('DocsTrustFooter — buildSuggestEditUrl', () => {
  it('returns an https GitHub issue URL', () => {
    const url = buildSuggestEditUrl('/docs/api/policies/evaluate', 'en');
    expect(url.startsWith('https://github.com/aster-cloud/aster-cloud/issues/new?')).toBe(true);
  });

  it('includes the route slug in the title and body', () => {
    const url = buildSuggestEditUrl('/docs/getting-started/quickstart', 'en');
    const params = new URL(url).searchParams;
    expect(params.get('title')).toBe('Docs: /docs/getting-started/quickstart');
    expect(params.get('body')).toContain('Page: /docs/getting-started/quickstart');
  });

  it('includes the locale in the body so triage knows the language', () => {
    const url = buildSuggestEditUrl('/docs/api/policies/evaluate', 'zh');
    expect(new URL(url).searchParams.get('body')).toContain('Locale: zh');
  });

  it('tags with docs + suggestion labels', () => {
    const url = buildSuggestEditUrl('/docs/api/policies/evaluate', 'en');
    expect(new URL(url).searchParams.get('labels')).toBe('docs,suggestion');
  });
});

describe('DocsTrustFooter — formatDate', () => {
  it('returns null for empty input', () => {
    expect(formatDate(undefined, 'en')).toBeNull();
  });

  it('returns the raw value for unparseable input', () => {
    expect(formatDate('not-a-date', 'en')).toBe('not-a-date');
  });

  it('formats a valid ISO date in the requested locale', () => {
    const out = formatDate('2026-06-03', 'en');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Jun/);
  });

  it('respects the UTC timezone so date-only frontmatter does not shift', () => {
    // Regression: `new Date('2026-06-03')` is UTC midnight; rendering
    // in `America/Los_Angeles` without `timeZone: 'UTC'` would yield
    // `Jun 2, 2026`. The production helper passes `timeZone: 'UTC'`
    // so the output reflects the calendar date the MDX author wrote.
    const out = formatDate('2026-06-03', 'en');
    expect(out).toContain('3');
    expect(out).not.toContain('2,');
  });
});

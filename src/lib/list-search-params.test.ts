/**
 * Unit tests for the list URL state helper.
 *
 * Coverage focuses on the canonical-form rules from
 * .claude/plan/list-pagination.md §2.2 and on the auto-reset behaviour
 * that protects against filter/page double-fetch races.
 */
import { describe, expect, it } from 'vitest';
import {
  buildListUrl,
  clampPage,
  parseListUrlState,
  type ListUrlOptions,
} from './list-search-params';

const OPTS: ListUrlOptions = {
  defaultPageSize: 50,
  allowedPageSizes: [25, 50, 100],
  filterKeys: ['domain', 'locale', 'kind'],
};

describe('parseListUrlState', () => {
  it('returns sensible defaults for an empty bag', () => {
    const s = parseListUrlState({}, OPTS);
    expect(s).toEqual({
      page: 1,
      pageSize: 50,
      q: undefined,
      filters: {},
    });
  });

  it('parses valid page / pageSize / q / filters', () => {
    const s = parseListUrlState(
      { page: '3', pageSize: '25', q: ' hello ', domain: 'finance', locale: 'en' },
      OPTS,
    );
    expect(s).toEqual({
      page: 3,
      pageSize: 25,
      q: 'hello',
      filters: { domain: 'finance', locale: 'en' },
    });
  });

  it('falls back when page or pageSize is bogus', () => {
    expect(parseListUrlState({ page: 'abc' }, OPTS).page).toBe(1);
    expect(parseListUrlState({ page: '0' }, OPTS).page).toBe(1);
    expect(parseListUrlState({ page: '-5' }, OPTS).page).toBe(1);
    expect(parseListUrlState({ pageSize: '99' }, OPTS).pageSize).toBe(50);
    expect(parseListUrlState({ pageSize: '25' }, OPTS).pageSize).toBe(25);
  });

  it('drops filters not on the allow-list', () => {
    const s = parseListUrlState(
      { domain: 'finance', wat: 'lol', locale: 'en' },
      OPTS,
    );
    expect(s.filters).toEqual({ domain: 'finance', locale: 'en' });
  });

  it('drops empty q', () => {
    expect(parseListUrlState({ q: '' }, OPTS).q).toBeUndefined();
    expect(parseListUrlState({ q: '   ' }, OPTS).q).toBeUndefined();
  });

  it('accepts URLSearchParams', () => {
    const sp = new URLSearchParams('page=2&pageSize=100&kind=struct');
    expect(parseListUrlState(sp, OPTS)).toEqual({
      page: 2,
      pageSize: 100,
      q: undefined,
      filters: { kind: 'struct' },
    });
  });

  it('takes the first value when duplicate keys arrive as arrays', () => {
    const s = parseListUrlState({ page: ['2', '3'] }, OPTS);
    expect(s.page).toBe(2);
  });
});

describe('buildListUrl canonical form', () => {
  const state = parseListUrlState({}, OPTS);

  it('omits page=1 and default pageSize', () => {
    expect(buildListUrl('/x', state, {}, OPTS)).toBe('/x');
  });

  it('emits page when > 1', () => {
    expect(
      buildListUrl('/x', state, { page: 4, resetPage: false }, OPTS),
    ).toBe('/x?page=4');
  });

  it('emits pageSize when non-default', () => {
    expect(buildListUrl('/x', state, { pageSize: 100 }, OPTS)).toBe(
      '/x?pageSize=100',
    );
  });

  it('drops q when empty after trim', () => {
    expect(buildListUrl('/x', state, { q: '   ' }, OPTS)).toBe('/x');
  });

  it('emits filters and preserves stable key order', () => {
    expect(
      buildListUrl(
        '/x',
        state,
        { filters: { domain: 'finance', kind: 'struct' } },
        OPTS,
      ),
    ).toBe('/x?domain=finance&kind=struct');
  });

  it('drops filters explicitly set to empty/undefined', () => {
    const next = parseListUrlState({ domain: 'finance', locale: 'en' }, OPTS);
    expect(
      buildListUrl('/x', next, { filters: { domain: undefined } }, OPTS),
    ).toBe('/x?locale=en');
  });
});

describe('buildListUrl auto-reset', () => {
  const startedAtPage5 = parseListUrlState({ page: '5', domain: 'finance' }, OPTS);

  it('resets to page 1 when a filter changes', () => {
    const next = buildListUrl(
      '/x',
      startedAtPage5,
      { filters: { domain: 'health' } },
      OPTS,
    );
    expect(next).toBe('/x?domain=health');
  });

  it('resets to page 1 when q changes', () => {
    const next = buildListUrl('/x', startedAtPage5, { q: 'loan' }, OPTS);
    expect(next).toBe('/x?q=loan&domain=finance');
  });

  it('resets to page 1 when pageSize changes', () => {
    const next = buildListUrl('/x', startedAtPage5, { pageSize: 25 }, OPTS);
    expect(next).toBe('/x?pageSize=25&domain=finance');
  });

  it('does NOT reset when only page changes (pure navigation)', () => {
    const next = buildListUrl('/x', startedAtPage5, { page: 6 }, OPTS);
    expect(next).toBe('/x?page=6&domain=finance');
  });

  it('honors explicit resetPage=false even on filter change', () => {
    const next = buildListUrl(
      '/x',
      startedAtPage5,
      { filters: { domain: 'health' }, resetPage: false },
      OPTS,
    );
    expect(next).toBe('/x?page=5&domain=health');
  });
});

describe('clampPage', () => {
  it('clamps requested page into the valid range', () => {
    expect(clampPage(999, 30, 25)).toEqual({ clamped: 2, totalPages: 2 });
    expect(clampPage(0, 30, 25)).toEqual({ clamped: 1, totalPages: 2 });
    expect(clampPage(-5, 30, 25)).toEqual({ clamped: 1, totalPages: 2 });
  });

  it('treats total=0 as a single empty page', () => {
    expect(clampPage(7, 0, 25)).toEqual({ clamped: 1, totalPages: 1 });
  });

  it('handles total that fits exactly on the last page', () => {
    expect(clampPage(2, 50, 25)).toEqual({ clamped: 2, totalPages: 2 });
    expect(clampPage(3, 50, 25)).toEqual({ clamped: 2, totalPages: 2 });
  });
});

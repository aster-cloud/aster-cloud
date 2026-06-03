/**
 * Pure-helper coverage for the docs visit tracking module.
 * `pushVisit` is the operation the localStorage layer hangs off of —
 * dedupe-by-slug and bounded length are the user-facing invariants.
 */

import { describe, it, expect } from 'vitest';
import { pushVisit, type Visit } from '@/lib/docs/use-visit-tracking';

const v = (slug: string, ts: number): Visit => ({
  slug,
  title: slug,
  ts,
});

describe('pushVisit', () => {
  it('inserts a visit at the head when the slug is new', () => {
    const result = pushVisit([v('a', 1), v('b', 2)], v('c', 3));
    expect(result.map((x) => x.slug)).toEqual(['c', 'a', 'b']);
  });

  it('promotes an existing slug to the head (dedupe by slug)', () => {
    const result = pushVisit([v('a', 1), v('b', 2), v('c', 3)], v('b', 4));
    expect(result.map((x) => x.slug)).toEqual(['b', 'a', 'c']);
    // Latest timestamp wins.
    expect(result[0].ts).toBe(4);
  });

  it('caps the list at 20 entries', () => {
    const existing: Visit[] = Array.from({ length: 25 }, (_, i) =>
      v(`page-${i}`, i),
    );
    const result = pushVisit(existing, v('new', 100));
    expect(result.length).toBe(20);
    expect(result[0].slug).toBe('new');
  });

  it('handles an empty existing list', () => {
    const result = pushVisit([], v('a', 1));
    expect(result).toEqual([v('a', 1)]);
  });
});

/**
 * Behavioural coverage for the docs search runtime: ranking tiers,
 * synonym expansion, current-route boost, result limit.
 */

import { describe, it, expect } from 'vitest';
import {
  expandQuery,
  searchDocs,
  type SearchIndex,
} from '@/lib/docs/search-runtime';

const sampleIndex: SearchIndex = {
  locale: 'en',
  entries: [
    {
      slug: 'getting-started/quickstart',
      title: 'Quick Start',
      description: 'Walks you through your first policy evaluation.',
      headings: ['Prerequisites', 'Set Your Credentials', 'Evaluate a Policy'],
    },
    {
      slug: 'api/policies/evaluate',
      title: 'Evaluate Policy',
      description: 'Evaluate a deployed policy by module and function name.',
      headings: ['Required Role', 'Request Body', 'Response'],
    },
    {
      slug: 'api/audit/logs',
      title: 'Audit Logs',
      description: 'Query the immutable audit log for compliance review.',
      headings: ['Filters', 'Pagination', 'Examples'],
    },
    {
      slug: 'getting-started/authentication',
      title: 'Authentication',
      description: 'Configure HMAC signing for production requests.',
      headings: ['HMAC Headers', 'Replay Window', 'Failure Modes'],
    },
  ],
};

describe('expandQuery', () => {
  it('returns lowercase tokens, deduped', () => {
    expect(expandQuery('Evaluate Evaluate')).toEqual(['evaluate']);
  });

  it('respects the synonym map', () => {
    const tokens = expandQuery('auth', { auth: 'authentication' });
    expect(tokens).toContain('auth');
    expect(tokens).toContain('authentication');
  });

  it('drops punctuation around tokens', () => {
    expect(expandQuery('"audit",')).toContain('audit');
  });
});

describe('searchDocs ranking', () => {
  it('ranks exact title above prefix match', () => {
    const hits = searchDocs('audit logs', sampleIndex);
    expect(hits[0].entry.slug).toBe('api/audit/logs');
  });

  it('ranks title match above heading match', () => {
    const hits = searchDocs('evaluate', sampleIndex);
    // "Evaluate Policy" (title) ranks above "Evaluate a Policy" (heading)
    expect(hits[0].entry.slug).toBe('api/policies/evaluate');
  });

  it('returns empty array for whitespace-only query', () => {
    expect(searchDocs('   ', sampleIndex)).toEqual([]);
  });

  it('returns empty array for unmatched query', () => {
    expect(searchDocs('nonexistent gibberish', sampleIndex)).toEqual([]);
  });

  it('respects the limit option', () => {
    const hits = searchDocs('policy', sampleIndex, { limit: 1 });
    expect(hits.length).toBe(1);
  });

  it('current-route boost bubbles same-tier matches', () => {
    // "policy" matches the title-prefix of Evaluate Policy (TIER 700)
    // and Quick Start (title-prefix? no — "Quick Start" doesn't
    // contain "policy"). So I use a tighter probe: searching for
    // "audit" matches Audit Logs's title (700) and there are no
    // other title-tier matches. Within the same tier, alphabetical
    // slug order is the tiebreaker. Add a synthetic second
    // title-match to demonstrate the boost.
    const indexWithTie: SearchIndex = {
      locale: 'en',
      entries: [
        {
          slug: 'a-page',
          title: 'Audit',
          description: '',
          headings: [],
        },
        {
          slug: 'z-page',
          title: 'Audit',
          description: '',
          headings: [],
        },
      ],
    };
    const baseline = searchDocs('audit', indexWithTie);
    expect(baseline[0].entry.slug).toBe('a-page'); // alphabetical tiebreak
    const boosted = searchDocs('audit', indexWithTie, {
      boostSlug: 'z-page',
    });
    expect(boosted[0].entry.slug).toBe('z-page'); // boost wins same tier
  });

  it('current-route boost does NOT override tier ordering', () => {
    // True cross-tier guarantee: even when the user is on a page
    // with only a description match, a title-match elsewhere still
    // wins. The +50 boost is intentionally smaller than the gap
    // between any two tiers (description 250 < heading 500).
    const indexCrossTier: SearchIndex = {
      locale: 'en',
      entries: [
        {
          slug: 'page-with-title-match',
          title: 'audit',
          description: '',
          headings: [],
        },
        {
          slug: 'page-with-description-only',
          title: 'Unrelated',
          description: 'discussion of audit topics',
          headings: [],
        },
      ],
    };
    const hits = searchDocs('audit', indexCrossTier, {
      boostSlug: 'page-with-description-only',
    });
    // Title match wins (1000) over boosted description (250 + 50).
    expect(hits[0].entry.slug).toBe('page-with-title-match');
  });

  it('synonym map widens recall without changing tier', () => {
    const hits = searchDocs('auth', sampleIndex, {
      synonyms: { auth: 'authentication' },
    });
    expect(hits[0].entry.slug).toBe('getting-started/authentication');
  });

  it('matched field is reported in the result', () => {
    const hits = searchDocs('compliance', sampleIndex);
    expect(hits[0].matchedIn).toBe('description');
  });
});

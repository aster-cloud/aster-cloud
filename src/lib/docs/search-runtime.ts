/**
 * Pure search runtime — substring + prefix matching with synonym
 * expansion. No third-party deps (Fuse / Lunr would each add several
 * KB of Worker bundle for marginal quality gain at our corpus size).
 *
 * Public surface:
 *   - `searchDocs(query, index, opts)` → ranked array of hits
 *   - `expandQuery(query, locale)` returns the synonym-extended token
 *     list for an input phrase, used by callers that want to highlight
 *     why a match was returned.
 *
 * Ranking (highest → lowest):
 *   1. Exact title match
 *   2. Title token-prefix match
 *   3. Heading match
 *   4. Description match
 *   5. Slug match (last resort — gives "graphql" → graphql/* anchors)
 *
 * Current-route boost: callers can pass `boostSlug` so the entry the
 * reader is currently on bubbles up. We add a fixed bonus, never
 * change the rank tiers, so cross-tier matches still beat in-tier
 * matches on the same page.
 */

import type { SynonymMap } from '@/lib/docs/synonyms';

export type SearchEntry = {
  slug: string;
  title: string;
  description: string;
  headings: string[];
};

export type SearchIndex = {
  locale: string;
  entries: SearchEntry[];
};

export type SearchHit = {
  entry: SearchEntry;
  /** Numeric score — higher is better. Stable per call, not absolute. */
  score: number;
  /** Which field surfaced the match — used by UI to show "matched in headings". */
  matchedIn: 'title' | 'heading' | 'description' | 'slug';
};

export type SearchOptions = {
  /** Slug of the page the reader is currently on. Adds a small boost. */
  boostSlug?: string;
  /** Synonym map for the active locale. Bypass with `{}` to disable. */
  synonyms?: SynonymMap;
  /** Maximum result count. */
  limit?: number;
};

const TIER_TITLE_EXACT = 1000;
const TIER_TITLE_PREFIX = 700;
const TIER_HEADING = 500;
const TIER_DESCRIPTION = 250;
const TIER_SLUG = 100;
const BOOST_CURRENT_ROUTE = 50;

/** Normalize a token: lowercase + strip surrounding punctuation. */
function normalize(token: string): string {
  return token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/**
 * Expand a query into its canonical tokens plus every synonym that
 * resolves to the same canonical form. Unknown tokens pass through
 * verbatim so a user typing a specific identifier still finds it.
 */
export function expandQuery(query: string, synonyms: SynonymMap = {}): string[] {
  const rawTokens = query
    .split(/\s+/)
    .map(normalize)
    .filter((t) => t.length > 0);
  const expanded = new Set<string>();
  for (const token of rawTokens) {
    expanded.add(token);
    const canonical = synonyms[token];
    if (canonical) {
      expanded.add(canonical);
    }
  }
  return Array.from(expanded);
}

function fieldMatches(field: string, tokens: string[]): boolean {
  if (!field) return false;
  const low = field.toLowerCase();
  return tokens.some((tok) => low.includes(tok));
}

function tokenPrefixMatches(field: string, tokens: string[]): boolean {
  if (!field) return false;
  const fieldTokens = field
    .toLowerCase()
    .split(/[\s/_-]+/)
    .filter((t) => t.length > 0);
  return tokens.some((tok) =>
    fieldTokens.some((ft) => ft.startsWith(tok)),
  );
}

function exactTitleMatch(title: string, tokens: string[]): boolean {
  return tokens.length === 1 && normalize(title) === tokens[0];
}

/**
 * Score a single entry against the expanded token set. Returns the
 * first matching tier (we don't sum tiers — a heading match shouldn't
 * out-score a title match).
 */
function scoreEntry(
  entry: SearchEntry,
  tokens: string[],
  boostSlug?: string,
): { score: number; matchedIn: SearchHit['matchedIn'] } | null {
  let tier: { score: number; matchedIn: SearchHit['matchedIn'] } | null = null;
  if (exactTitleMatch(entry.title, tokens)) {
    tier = { score: TIER_TITLE_EXACT, matchedIn: 'title' };
  } else if (
    fieldMatches(entry.title, tokens) ||
    tokenPrefixMatches(entry.title, tokens)
  ) {
    tier = { score: TIER_TITLE_PREFIX, matchedIn: 'title' };
  } else if (entry.headings.some((h) => fieldMatches(h, tokens))) {
    tier = { score: TIER_HEADING, matchedIn: 'heading' };
  } else if (fieldMatches(entry.description, tokens)) {
    tier = { score: TIER_DESCRIPTION, matchedIn: 'description' };
  } else if (fieldMatches(entry.slug, tokens)) {
    tier = { score: TIER_SLUG, matchedIn: 'slug' };
  }
  if (!tier) return null;
  if (boostSlug && entry.slug === boostSlug) {
    tier = { ...tier, score: tier.score + BOOST_CURRENT_ROUTE };
  }
  return tier;
}

/**
 * Run a search query against an index. Pure function — safe to call
 * server- or client-side.
 */
export function searchDocs(
  query: string,
  index: SearchIndex,
  opts: SearchOptions = {},
): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const tokens = expandQuery(trimmed, opts.synonyms);
  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const entry of index.entries) {
    const scored = scoreEntry(entry, tokens, opts.boostSlug);
    if (scored) {
      hits.push({ entry, score: scored.score, matchedIn: scored.matchedIn });
    }
  }
  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.entry.slug.localeCompare(b.entry.slug);
  });
  const limit = opts.limit ?? 8;
  return hits.slice(0, limit);
}

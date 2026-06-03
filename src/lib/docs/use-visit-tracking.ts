'use client';

/**
 * Lightweight per-page visit tracking that runs entirely on the
 * client. localStorage-only; never crosses the network.
 *
 * What it stores: the slug (path under `/docs/`), the rendered page
 * title, and a millisecond timestamp. Deduplicated by slug so the
 * "Recent docs" list shows each page at most once, ordered by most
 * recent visit. Capped at 20 entries so the storage cost stays in
 * the noise.
 *
 * Privacy: no user identifier is read or persisted. The browser
 * clears the list with normal "Clear site data" controls; no server
 * has access. This is the same posture as the docs-session cache,
 * matching the PII-free contract that drives the whole Phase 1+
 * design.
 *
 * Concurrency: writes use a get-modify-write cycle on the same
 * localStorage key. Two tabs writing simultaneously could lose a
 * visit, which is acceptable — losing a single recent entry is
 * benign and the next visit refills it.
 */

import { useEffect } from 'react';

const STORAGE_KEY = 'aster.docs.visits';
const MAX_ENTRIES = 20;
const SCHEMA_VERSION = 1;

export type Visit = {
  slug: string;
  title: string;
  /** Unix epoch ms. */
  ts: number;
};

type StoredEnvelope = {
  schemaVersion: number;
  entries: Visit[];
};

/**
 * Read visits from localStorage. Returns empty when storage is
 * unavailable, schema mismatched, or parsing fails.
 */
export function readVisits(): Visit[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredEnvelope;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return [];
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(
      (v) =>
        v &&
        typeof v.slug === 'string' &&
        typeof v.title === 'string' &&
        typeof v.ts === 'number',
    );
  } catch {
    return [];
  }
}

/**
 * Exported so other client surfaces (e.g. DocsVisitRecorder) can
 * share the schema envelope without re-declaring it. Internal
 * callers can still rely on the same write path.
 */
export function writeVisits(entries: Visit[]): void {
  if (typeof window === 'undefined') return;
  try {
    const envelope: StoredEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      entries: entries.slice(0, MAX_ENTRIES),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Quota exceeded / private mode — silently drop.
  }
}

/**
 * Insert a visit at the head, deduplicating by slug. Pure function so
 * tests can exercise it without a DOM environment.
 */
export function pushVisit(existing: Visit[], visit: Visit): Visit[] {
  const filtered = existing.filter((v) => v.slug !== visit.slug);
  return [visit, ...filtered].slice(0, MAX_ENTRIES);
}

/**
 * Hook used by the docs layout to record the current page's visit
 * once after hydration. The `slug` is the leg-only path under
 * `/docs/`, so passing the same value across re-renders is a no-op.
 */
export function useTrackVisit(slug: string, title: string): void {
  useEffect(() => {
    if (!slug || !title) return;
    const existing = readVisits();
    const next = pushVisit(existing, { slug, title, ts: Date.now() });
    writeVisits(next);
  }, [slug, title]);
}

/**
 * URL state helper for paginated list pages.
 *
 * Why this lives here:
 *   The policies, vocab and snapshots pages all need the same parse-
 *   then-build cycle for ?page=&pageSize=&q=&<filter>=. Hand-rolling
 *   it per page reliably ships drift — one page omits the default,
 *   another doesn't; one resets page on filter change, another races.
 *   This module is the single source of truth: every list page parses
 *   via parseListUrlState and every URL mutation goes through
 *   buildListUrl. Tests live next door.
 *
 * Canonical form rules:
 *   - page === 1                                      → drop
 *   - pageSize === defaultPageSize                    → drop
 *   - q.trim() === ''                                 → drop
 *   - filter value === '' / null / undefined          → drop
 *   - filter key not in the configured filterKeys     → drop
 *
 *   Result: bare /policies and /policies?domain=finance both round-trip
 *   stably with no redundant pageSize=20 noise in the URL bar.
 *
 * Atomic patch rules:
 *   - resetPage: true forces page=1 in the next URL regardless of patch.
 *   - Any filter/q/pageSize change implicitly sets resetPage: true
 *     unless the caller explicitly passes resetPage: false.
 *   - Pure page-number patches (next/prev) do not reset.
 */

export interface ListUrlState {
  page: number;
  pageSize: number;
  q?: string;
  /** Page-specific filters; only keys in opts.filterKeys are preserved. */
  filters: Record<string, string>;
}

export interface ListUrlOptions {
  defaultPageSize: number;
  /** Allowed page sizes. Values outside this set fall back to default. */
  allowedPageSizes: readonly number[];
  /**
   * Page-specific filter keys. Anything not in this list is dropped on
   * parse; this keeps URLs from carrying stale params after a feature
   * removes a filter.
   */
  filterKeys: readonly string[];
}

type SearchInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

/**
 * Parse a search-param bag into a normalized ListUrlState. Values that
 * fail to parse (page=abc, pageSize=99 when not allowed) fall back to
 * defaults silently — this mirrors how a clamp-on-server policy works:
 * we never throw at the user for a malformed URL.
 */
export function parseListUrlState(
  input: SearchInput,
  opts: ListUrlOptions,
): ListUrlState {
  const get = makeGetter(input);

  const pageRaw = get('page');
  const pageParsed = pageRaw ? Number.parseInt(pageRaw, 10) : NaN;
  const page = Number.isInteger(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  const sizeRaw = get('pageSize');
  const sizeParsed = sizeRaw ? Number.parseInt(sizeRaw, 10) : NaN;
  const pageSize =
    Number.isInteger(sizeParsed) && opts.allowedPageSizes.includes(sizeParsed)
      ? sizeParsed
      : opts.defaultPageSize;

  const qRaw = get('q');
  const q = qRaw && qRaw.trim() !== '' ? qRaw.trim() : undefined;

  const filters: Record<string, string> = {};
  for (const key of opts.filterKeys) {
    const value = get(key);
    if (typeof value === 'string' && value.trim() !== '') {
      filters[key] = value.trim();
    }
  }

  return { page, pageSize, q, filters };
}

export interface BuildListUrlPatch {
  page?: number;
  pageSize?: number;
  q?: string;
  /** Replace or merge filters; pass undefined value to drop a single key. */
  filters?: Record<string, string | undefined>;
  /**
   * Override the auto-derived reset behavior. By default any filter / q /
   * pageSize change resets page to 1; pass false to keep the current
   * page (rare — typically only when the caller knows the patch doesn't
   * change which rows the server returns).
   */
  resetPage?: boolean;
}

/**
 * Build the next URL string from current state + a patch. Returns a
 * pathname-relative URL (no origin) so callers can pass it straight to
 * <Link> or router.replace.
 */
export function buildListUrl(
  pathname: string,
  current: ListUrlState,
  patch: BuildListUrlPatch,
  opts: ListUrlOptions,
): string {
  const merged = mergePatch(current, patch);
  const params = new URLSearchParams();

  if (merged.page !== 1) {
    params.set('page', String(merged.page));
  }
  if (merged.pageSize !== opts.defaultPageSize) {
    params.set('pageSize', String(merged.pageSize));
  }
  if (merged.q) {
    params.set('q', merged.q);
  }
  for (const key of opts.filterKeys) {
    const v = merged.filters[key];
    if (typeof v === 'string' && v !== '') {
      params.set(key, v);
    }
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Apply a patch to a list state. Filter / search / pageSize patches
 * default resetPage to true. Pure page patches default to false.
 */
function mergePatch(
  current: ListUrlState,
  patch: BuildListUrlPatch,
): ListUrlState {
  const hasFilterChange = patch.filters !== undefined;
  const hasQueryChange = patch.q !== undefined;
  const hasSizeChange =
    patch.pageSize !== undefined && patch.pageSize !== current.pageSize;
  const hasPageChange =
    patch.page !== undefined && patch.page !== current.page;

  const autoReset = hasFilterChange || hasQueryChange || hasSizeChange;
  const shouldReset =
    patch.resetPage !== undefined ? patch.resetPage : autoReset;

  let nextPage = patch.page ?? current.page;
  if (shouldReset && !hasPageChange) {
    nextPage = 1;
  } else if (shouldReset && hasPageChange) {
    // Explicit page patch wins over auto-reset; this lets a caller set
    // resetPage=false implicitly by also setting page=N in the same call.
    nextPage = patch.page ?? 1;
  }

  const nextPageSize = patch.pageSize ?? current.pageSize;

  let nextQ: string | undefined;
  if (hasQueryChange) {
    const v = patch.q?.trim() ?? '';
    nextQ = v === '' ? undefined : v;
  } else {
    nextQ = current.q;
  }

  const nextFilters: Record<string, string> = { ...current.filters };
  if (patch.filters) {
    for (const [key, value] of Object.entries(patch.filters)) {
      if (value === undefined || value === null || value === '') {
        delete nextFilters[key];
      } else {
        nextFilters[key] = value;
      }
    }
  }

  return {
    page: Math.max(1, nextPage),
    pageSize: nextPageSize,
    q: nextQ,
    filters: nextFilters,
  };
}

/**
 * Clamp a parsed page to the actual page range derived from total +
 * pageSize. Use this in server components to decide between rendering
 * the requested page or redirecting to the last valid one.
 */
export function clampPage(
  page: number,
  total: number,
  pageSize: number,
): { clamped: number; totalPages: number } {
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const clamped = Math.min(Math.max(1, page), totalPages);
  return { clamped, totalPages };
}

function makeGetter(input: SearchInput) {
  if (input instanceof URLSearchParams) {
    return (key: string) => input.get(key) ?? undefined;
  }
  return (key: string) => {
    const value = input[key];
    if (Array.isArray(value)) return value[0];
    return value ?? undefined;
  };
}

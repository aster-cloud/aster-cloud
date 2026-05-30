/**
 * Pagination — list page numbered control.
 *
 * TODO(design-system): migrate to @aster-cloud/ui in a follow-up PR.
 * Lives in aster-cloud temporarily because the design system has a
 * separate release cadence and shipping pagination across three pages
 * is the prerequisite for the F1-F12 vocabulary surface + the policies
 * page consolidation. The component is intentionally self-contained
 * (no app-specific imports beyond next-intl) so the migration is a
 * file move + import-path update, nothing more.
 *
 * Contract:
 *   - Layout-agnostic: callers render this as a sibling below their
 *     DataTable/grid; the component does not own the list view.
 *   - URL-canonical: callers pass `buildHref` and the component renders
 *     <Link> nodes for each page button. Clicks are normal navigation
 *     (no router.replace inside the component) so SSR + back/forward
 *     work without extra wiring.
 *   - Optional onPageChange/onPageSizeChange escape hatch for callers
 *     that drive state without URLs (rare; reserved for future client-
 *     only sub-views).
 *
 * Visual rules (mirrors the plan in .claude/plan/list-pagination.md):
 *   - Desktop ≥ sm: status line + numbered window (with ellipses) + next/
 *     prev + per-page selector laid out as a single row.
 *   - Mobile < sm: vertical stack — status / prev+label+next / selector.
 *   - Single page (totalPages ≤ 1 with total > 0): hide numbered controls
 *     but keep the status line + selector.
 *   - total === 0: render nothing (the caller's EmptyState owns
 *     communication).
 *
 * a11y:
 *   - <nav aria-label="Pagination"> wraps the numbered controls.
 *   - Current page carries aria-current="page".
 *   - Disabled prev/next render as <span aria-disabled="true"> rather
 *     than <Link>, so they're not in the tab order and screen readers
 *     announce them as disabled.
 *   - A polite live region announces "Page X of Y, showing A-B of N
 *     items" whenever the props change; AT users hear the state without
 *     polling the DOM.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn, Select } from '@/components/ui';

export interface PaginationProps {
  /** Current page (1-indexed). */
  page: number;
  pageSize: number;
  total: number;
  /** Selectable page sizes. Defaults to [25, 50, 100]. */
  pageSizeOptions?: number[];
  /**
   * Builds the href for a given (page, pageSize). The wrapper page is
   * responsible for omitting default values so the resulting URL stays
   * canonical (see src/lib/list-search-params.ts:buildListUrl).
   */
  buildHref: (next: { page: number; pageSize: number }) => string;
  /**
   * Escape hatch for client-only sub-views. When provided, page-size
   * changes call this instead of navigating. Page-number clicks always
   * navigate via buildHref + <Link>.
   */
  onPageSizeChange?: (size: number) => void;
  /** Item noun for the status line; defaults to localized "items". */
  itemNoun?: string;
  className?: string;
  /**
   * When the caller knows the data fits one page but wants the page-size
   * selector still visible (e.g. user has 12 rows but might want to
   * preview the 25-row layout), pass singlePage. The component otherwise
   * derives single-page state from totalPages.
   */
  singlePage?: boolean;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [25, 50, 100];

export function Pagination({
  page,
  pageSize,
  total,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  buildHref,
  onPageSizeChange,
  itemNoun,
  className,
  singlePage,
}: PaginationProps) {
  const t = useTranslations('pagination');

  // Bail completely when the list is empty — the caller's EmptyState is
  // the right communication surface for "no data", not a Pagination row.
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = clamp(page, 1, totalPages);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(total, currentPage * pageSize);
  const noun = itemNoun ?? t('itemNoun');
  const onlyOnePage = singlePage ?? totalPages <= 1;

  const statusLine = t('showing', { start, end, total, noun });
  // The live region carries the same status text so screen readers hear
  // it on every page change. Belt-and-braces with aria-live below.
  const liveText = t('pageOf', { page: currentPage, totalPages });

  return (
    <nav
      aria-label={t('label')}
      className={cn(
        'mt-4 flex flex-col items-stretch gap-3 border-t border-border pt-3 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <PolitePageStatus text={`${statusLine}. ${liveText}.`} />

      <p className="order-1 text-fg-muted sm:order-none">{statusLine}</p>

      {!onlyOnePage ? (
        <PaginationButtons
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          buildHref={buildHref}
          labelPrevious={t('previous')}
          labelNext={t('next')}
          labelGoToPage={(n: number) => t('goToPage', { page: n })}
          labelEllipsis={t('ellipsis')}
        />
      ) : null}

      <div className="order-2 flex items-center gap-2 sm:order-none">
        <label htmlFor="pagination-page-size" className="text-xs text-fg-muted">
          {t('itemsPerPage')}
        </label>
        <Select
          id="pagination-page-size"
          size="sm"
          value={String(pageSize)}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10);
            if (!Number.isFinite(next) || next <= 0) return;
            if (onPageSizeChange) {
              onPageSizeChange(next);
              return;
            }
            // No escape-hatch callback — navigate via buildHref so the
            // page-size change lands in the URL alongside any other
            // params the caller's URL helper preserves. Reset to page 1
            // because the current page index becomes meaningless under
            // a new page size.
            window.location.href = buildHref({ page: 1, pageSize: next });
          }}
          aria-label={t('itemsPerPage')}
        >
          {pageSizeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      </div>
    </nav>
  );
}

interface PaginationButtonsProps {
  page: number;
  totalPages: number;
  pageSize: number;
  buildHref: (next: { page: number; pageSize: number }) => string;
  labelPrevious: string;
  labelNext: string;
  labelGoToPage: (page: number) => string;
  labelEllipsis: string;
}

/**
 * The actual click targets. Numbered windowing keeps at most ~7 buttons
 * visible on desktop (first, last, current ±1, plus up to two ellipses).
 * Mobile collapses to "‹  Page X of Y  ›" since numbered windows wrap
 * uglily on narrow viewports.
 */
function PaginationButtons({
  page,
  totalPages,
  pageSize,
  buildHref,
  labelPrevious,
  labelNext,
  labelGoToPage,
  labelEllipsis,
}: PaginationButtonsProps) {
  const items = useMemo(() => pickWindow(page, totalPages), [page, totalPages]);
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <div className="order-0 flex items-center justify-center gap-1 sm:order-none">
      {prevDisabled ? (
        <span
          aria-disabled="true"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-subtle"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{labelPrevious}</span>
        </span>
      ) : (
        <Link
          href={buildHref({ page: page - 1, pageSize })}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg hover:bg-bg-subtle focus:outline-none focus-visible:shadow-ring"
          aria-label={labelPrevious}
          rel="prev"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}

      <ul className="hidden items-center gap-1 sm:flex">
        {items.map((item, idx) =>
          item === 'ellipsis' ? (
            <li key={`ellipsis-${idx}`} aria-hidden="true">
              <span className="inline-flex h-9 w-9 items-center justify-center text-fg-subtle">
                <MoreHorizontal className="h-4 w-4" aria-label={labelEllipsis} />
              </span>
            </li>
          ) : (
            <li key={item}>
              {item === page ? (
                <span
                  aria-current="page"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg"
                >
                  {item}
                </span>
              ) : (
                <Link
                  href={buildHref({ page: item, pageSize })}
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-3 text-sm font-medium text-fg hover:bg-bg-subtle focus:outline-none focus-visible:shadow-ring"
                  aria-label={labelGoToPage(item)}
                >
                  {item}
                </Link>
              )}
            </li>
          ),
        )}
      </ul>

      <span className="text-xs text-fg-muted sm:hidden" aria-hidden="true">
        {page} / {totalPages}
      </span>

      {nextDisabled ? (
        <span
          aria-disabled="true"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-subtle"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{labelNext}</span>
        </span>
      ) : (
        <Link
          href={buildHref({ page: page + 1, pageSize })}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-fg hover:bg-bg-subtle focus:outline-none focus-visible:shadow-ring"
          aria-label={labelNext}
          rel="next"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/**
 * Polite live region. We render the latest status text into a hidden
 * region; screen readers announce changes when the text changes. The
 * text is recomputed on every render so a page-change naturally fires
 * an announcement without us tracking previous values.
 *
 * The 'effect + timeout' pattern (clear then set) helps some readers
 * pick up successive updates that would otherwise dedupe.
 */
function PolitePageStatus({ text }: { text: string }) {
  const [announce, setAnnounce] = useState('');
  const previousRef = useRef<string>('');
  useEffect(() => {
    if (text === previousRef.current) return;
    previousRef.current = text;
    setAnnounce('');
    const id = window.setTimeout(() => setAnnounce(text), 50);
    return () => window.clearTimeout(id);
  }, [text]);
  return (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {announce}
    </span>
  );
}

/**
 * Choose which page numbers to show. Always include first/last and a
 * ±1 window around the current page; insert ellipses where the window
 * gaps over a non-adjacent stretch. Capped so we render at most 7
 * non-ellipsis items, keeping mobile-collapse predictable.
 */
function pickWindow(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return rangeInclusive(1, total);
  }
  const items: Array<number | 'ellipsis'> = [];
  const windowStart = Math.max(2, current - 1);
  const windowEnd = Math.min(total - 1, current + 1);
  items.push(1);
  if (windowStart > 2) items.push('ellipsis');
  for (let i = windowStart; i <= windowEnd; i++) items.push(i);
  if (windowEnd < total - 1) items.push('ellipsis');
  items.push(total);
  return items;
}

function rangeInclusive(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

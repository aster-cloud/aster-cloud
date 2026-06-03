'use client';

/**
 * Cmd+K / Ctrl+K search palette for the /docs subsite.
 *
 * Why a separate component from the dashboard's `<CommandPalette>`:
 *   - Docs is anonymous-friendly. The dashboard palette pulls in
 *     `buildCommands` which assumes a role + capabilities. Reusing
 *     it would either require shimming those fields (PII risk if we
 *     ever expose them client-side) or stripping them out — neither
 *     wins over a focused docs-only implementation.
 *   - Index data is lazy-loaded — the runtime substring matcher is
 *     ~150 LOC of pure code. No need to ship the dashboard's command
 *     catalog + Lucide icon map on docs routes.
 *   - Keeps the bundle delta tight: docs route only pays for the
 *     search shell (~5KB) plus the per-locale index (≤2KB gzipped).
 *
 * Lazy loading:
 *   - The matching `search-index.<locale>.json` and the runtime
 *     module are both dynamic-imported the first time the palette
 *     opens. Subsequent opens reuse the cached module.
 *
 * a11y:
 *   - Modal dialog with `role="dialog"` + `aria-modal`. Implemented
 *     with a div (not the native `<dialog>` element) so we can
 *     control the open animation and avoid the native dialog's
 *     dark-mode default styles. Focus trap, Escape close, focus
 *     return, and body scroll lock are implemented manually below.
 *   - Result list is `role="listbox"` with `aria-activedescendant`
 *     so arrow-key navigation works for SR users without moving
 *     keyboard focus off the input (ARIA APG combobox pattern).
 *   - Input has explicit `role="combobox"` + `aria-autocomplete="list"`
 *     so SR users get the combobox interaction model.
 *
 * Telemetry: emits `docs_search_opened` on first open and
 * `docs_search_result_clicked` when the user selects a result.
 * No query string is logged — privacy.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@aster-cloud/ui';
import { track, Events } from '@/lib/mixpanel';
import type {
  SearchHit,
  SearchIndex,
} from '@/lib/docs/search-runtime';

/**
 * Hard allow-list — keeps the dynamic `import(\`...search-index.${locale}.json\`)`
 * call bounded to the locales we actually ship. An unknown locale (a
 * user-supplied path segment that slipped past the router, future
 * locale rolled out unevenly, etc) silently falls back to en rather
 * than probing the bundler for an unsupported chunk.
 */
const SUPPORTED_LOCALES = ['en', 'zh', 'de'] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
function resolveLocale(locale: string): SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as SupportedLocale)
    : 'en';
}

const INDEX_BY_LOCALE: Record<string, SearchIndex | null> = {};
let runtimeModule:
  | typeof import('@/lib/docs/search-runtime')
  | null = null;
let synonymsModule: typeof import('@/lib/docs/synonyms') | null = null;

async function loadIndex(locale: string): Promise<SearchIndex | null> {
  const safe = resolveLocale(locale);
  if (INDEX_BY_LOCALE[safe]) return INDEX_BY_LOCALE[safe];
  try {
    const mod = await import(`@/lib/docs/search-index.${safe}.json`);
    const index = (mod.default ?? mod) as SearchIndex;
    INDEX_BY_LOCALE[safe] = index;
    return index;
  } catch {
    return null;
  }
}

async function loadRuntime() {
  if (!runtimeModule) {
    runtimeModule = await import('@/lib/docs/search-runtime');
  }
  return runtimeModule;
}

async function loadSynonyms() {
  if (!synonymsModule) {
    synonymsModule = await import('@/lib/docs/synonyms');
  }
  return synonymsModule;
}

/**
 * Strip the locale + /docs/ prefix from the current pathname so we
 * can boost the active page in the result list.
 */
function pathnameToSlug(pathname: string): string | undefined {
  const stripped = pathname.replace(/^\/[a-z]{2}(?=\/)/, '');
  const m = stripped.match(/^\/docs\/(.+?)\/?$/);
  return m?.[1];
}

/**
 * Build the locale-aware href for a search result. Docs URLs follow
 * the `localePrefix: 'as-needed'` shape — EN is bare, zh/de carry
 * their prefix.
 */
function buildHref(slug: string, locale: string): string {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  return `${prefix}/docs/${slug}`;
}

export function DocsCommandPalette() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = 'docs-cmdk-results';
  const trackedOpenRef = useRef(false);

  // Cmd+K / Ctrl+K toggle.
  //
  // We guard against hijacking typing contexts: when focus is inside
  // an input, textarea, or contenteditable element, the shortcut is
  // ignored so the user can still type Cmd+K shortcuts handled by
  // their app or browser (e.g. the URL bar focus moves there). Excludes
  // the palette's own input, which doesn't need re-toggle.
  //
  // The `aster.docs.open-search` custom event lets non-keyboard
  // surfaces (sidebar button, mobile FAB) request the palette without
  // simulating a keystroke.
  useEffect(() => {
    function isInTypingContext(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
      if (target.isContentEditable) return true;
      return false;
    }
    function onKey(ev: globalThis.KeyboardEvent) {
      const k = ev.key.toLowerCase();
      if ((ev.metaKey || ev.ctrlKey) && k === 'k') {
        if (isInTypingContext(ev.target)) return;
        ev.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpenRequest() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('aster.docs.open-search', onOpenRequest as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(
        'aster.docs.open-search',
        onOpenRequest as EventListener,
      );
    };
  }, []);

  // Track which element opened the palette so we can return focus on
  // close. Captured in a layout effect from `document.activeElement`
  // at the moment `open` transitions to true.
  const returnFocusToRef = useRef<HTMLElement | null>(null);

  // Body scroll lock — preserves the user's scroll position when the
  // backdrop overlays the page.
  // Plus a window-level Escape handler so the palette closes even when
  // focus has drifted (e.g. onto a result item by hover).
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onWindowKey(ev: globalThis.KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onWindowKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onWindowKey);
    };
  }, [open]);

  // Reset state on close + emit open telemetry exactly once per open.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      trackedOpenRef.current = false;
      // Return focus to whatever opened us — sidebar button, kbd, etc.
      const target = returnFocusToRef.current;
      if (target && typeof target.focus === 'function') {
        requestAnimationFrame(() => target.focus());
      }
      returnFocusToRef.current = null;
      return;
    }
    // Capture opener BEFORE the input grabs focus.
    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      returnFocusToRef.current = document.activeElement;
    }
    if (!trackedOpenRef.current) {
      track(Events.DOCS_SEARCH_OPENED, {
        source: 'cmdk',
        locale,
      });
      trackedOpenRef.current = true;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, locale]);

  // Run the search whenever the query or locale changes.
  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setResults([]);
      return;
    }
    void (async () => {
      const [index, runtime, synonyms] = await Promise.all([
        loadIndex(locale),
        loadRuntime(),
        loadSynonyms(),
      ]);
      if (cancelled || !index) return;
      const pathname =
        typeof window === 'undefined' ? '' : window.location.pathname;
      const hits = runtime.searchDocs(query, index, {
        boostSlug: pathnameToSlug(pathname),
        synonyms: synonyms.synonymsFor(locale),
      });
      if (!cancelled) {
        setResults(hits);
        setActiveIndex(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, locale]);

  const onSelectHit = useCallback(
    (hit: SearchHit) => {
      track(Events.DOCS_SEARCH_RESULT_CLICKED, {
        result_rank: results.indexOf(hit),
        result_slug: hit.entry.slug,
        locale,
      });
      router.push(buildHref(hit.entry.slug, locale));
      setOpen(false);
    },
    [results, router, locale],
  );

  const onKeyDownInput = useCallback(
    (ev: KeyboardEvent<HTMLInputElement>) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        setOpen(false);
        return;
      }
      // Focus trap runs regardless of result state — the dialog only
      // ever has one focusable element (the input). Tabbing away
      // would leak focus to the backdrop, breaking the modal
      // contract, even when results are empty. Process this before
      // the empty-results early return.
      if (ev.key === 'Tab') {
        ev.preventDefault();
        return;
      }
      if (results.length === 0) return;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        onSelectHit(results[activeIndex]);
      }
    },
    [results, activeIndex, onSelectHit],
  );

  const activeId = useMemo(
    () => (results[activeIndex] ? `docs-cmdk-opt-${results[activeIndex].entry.slug}` : undefined),
    [results, activeIndex],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="docs-cmdk-title"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-md border border-border bg-bg shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <label className="block">
          <span id="docs-cmdk-title" className="sr-only">
            {t('docs.search.placeholder')}
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            onKeyDown={onKeyDownInput}
            placeholder={t('docs.search.inputPlaceholder')}
            aria-controls={listboxId}
            aria-expanded={results.length > 0}
            aria-activedescendant={activeId}
            className={cn(
              'w-full rounded-t-md border-b border-border bg-bg px-4 py-3 text-sm text-fg',
              'focus:outline-none focus:ring-0',
            )}
          />
        </label>
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('docs.search.resultsLabel')}
          className="max-h-[60vh] overflow-y-auto"
        >
          {query.trim() && results.length === 0 && (
            <li className="px-4 py-3 text-sm text-fg-muted">
              {t('docs.search.noResults')}
            </li>
          )}
          {results.map((hit, i) => (
            <li
              key={hit.entry.slug}
              id={`docs-cmdk-opt-${hit.entry.slug}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => onSelectHit(hit)}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'cursor-pointer px-4 py-3 text-sm',
                i === activeIndex ? 'bg-bg-subtle' : 'hover:bg-bg-subtle',
              )}
            >
              <div className="font-medium text-fg">{hit.entry.title || hit.entry.slug}</div>
              {hit.entry.description && (
                <div className="mt-0.5 line-clamp-1 text-xs text-fg-muted">
                  {hit.entry.description}
                </div>
              )}
              <div className="mt-1 text-[10px] uppercase tracking-wider text-fg-muted/80">
                {t(`docs.search.matchedIn.${hit.matchedIn}`)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

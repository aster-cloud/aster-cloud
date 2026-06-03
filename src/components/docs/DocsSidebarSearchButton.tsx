'use client';

/**
 * Small "Search…" button at the top of the docs sidebar.
 *
 * Dispatches a `aster.docs.open-search` custom event picked up by
 * `<DocsCommandPalette>` to open the palette without simulating a
 * keystroke (which would race with synthetic-event blockers and
 * doesn't propagate to the same window event loop in all browsers).
 *
 * Visual: a labeled trigger plus a platform-aware shortcut hint.
 * On macOS we render ⌘K; on every other platform Ctrl+K. The
 * detection happens client-side once on mount; SSR markup renders
 * the Mac glyph as a stable fallback so React's hydration doesn't
 * warn about mismatched HTML.
 *
 * a11y: ordinary `<button>` — no menu semantics, no popup attributes.
 * The palette itself owns the focus-trap + dialog contract.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { cn } from '@aster-cloud/ui';

export function DocsSidebarSearchButton() {
  const t = useTranslations();
  // SSR-stable default: render the Mac shortcut, then swap to Ctrl+K
  // after hydration if the runtime tells us we're not on macOS.
  const [shortcut, setShortcut] = useState('⌘K');
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const platform = (navigator.platform || '').toLowerCase();
    const ua = (navigator.userAgent || '').toLowerCase();
    const isMac = platform.startsWith('mac') || ua.includes('mac os x');
    if (!isMac) setShortcut('Ctrl+K');
  }, []);

  const openSearch = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('aster.docs.open-search'));
  };

  return (
    <button
      type="button"
      onClick={openSearch}
      className={cn(
        'mb-6 flex w-full items-center justify-between gap-2 rounded-md border border-border bg-bg px-3 py-2',
        'text-left text-sm text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      )}
    >
      <span className="flex items-center gap-2">
        <Search className="h-4 w-4" aria-hidden="true" />
        <span>{t('docs.search.placeholder')}</span>
      </span>
      <kbd className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 text-[10px] font-mono text-fg-muted">
        {shortcut}
      </kbd>
    </button>
  );
}

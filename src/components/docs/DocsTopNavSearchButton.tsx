'use client';

/**
 * Compact search trigger for the docs top nav, placed to the left of
 * the language switcher.
 *
 * Dispatches the same `aster.docs.open-search` window event as the
 * (now retired) sidebar variant so `<DocsCommandPalette>` continues to
 * receive a single source of open requests. The compact pill style
 * fits inside the 64px nav row and collapses to an icon-only button
 * on narrow viewports where horizontal space is scarce.
 *
 * a11y:
 *   - Ordinary `<button>` with an `aria-label`; on narrow viewports
 *     where the visible "Search" label is hidden, the aria-label is
 *     the only announcement, so it must be translated.
 *   - The platform-aware ⌘K / Ctrl+K hint mirrors the sidebar button
 *     so the chord stays discoverable from anywhere in the chrome.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { cn } from '@aster-cloud/ui';

export function DocsTopNavSearchButton() {
  const t = useTranslations();
  // SSR-stable default — render the Mac glyph, then swap after
  // hydration if the runtime tells us we're not on macOS. Matches
  // DocsSidebarSearchButton's behavior so the chord hint is
  // consistent across both surfaces.
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
      aria-label={t('docs.search.placeholder')}
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5',
        'text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      )}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      {/* Hide the visible label on phones — the language switcher and
          NavRight take precedence in the cramped 320–375px window.
          aria-label keeps the button accessible regardless. */}
      <span className="hidden md:inline">{t('docs.search.placeholder')}</span>
      {/* 装饰性快捷键提示：标记 aria-hidden，避免它进入按钮的可访问名
          （否则内容计算出 "Search docs… ⌘K" 与 aria-label "Search docs…"
          不一致，触发 WCAG 2.5.3 label-content-name-mismatch）。 */}
      <kbd
        aria-hidden="true"
        className={cn(
          'hidden md:inline rounded border border-border bg-bg-subtle',
          'px-1.5 py-0.5 text-[10px] font-mono text-fg-muted',
        )}
      >
        {shortcut}
      </kbd>
    </button>
  );
}

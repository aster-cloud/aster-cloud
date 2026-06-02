'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Wordmark, cn } from '@aster-cloud/ui';
import { DocsLanguageSwitcher } from '@/components/docs/DocsLanguageSwitcher';

/**
 * Top nav for /docs/* — fixed, brand-left, switchers-right.
 *
 * Lighter than the main marketing nav: no Pricing / Docs links (we're
 * already in docs), and the right cluster only holds language + theme
 * affordances + a single "Open Console" CTA pointing back into the
 * authed app.
 *
 * Reuses the existing `<LanguageSwitcher>` and falls back on the
 * locale-layout-provided <ThemeProvider> for dark/light toggling
 * (toggle UI lives client-side in the LanguageSwitcher's neighbour
 * slot — Session 3 will add a dedicated icon button).
 */
export function DocsTopNav() {
  const t = useTranslations();
  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-20 h-16',
        'border-b border-border bg-bg/80 backdrop-blur-md',
      )}
    >
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label={t('nav.brand')}
          className="flex items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt=""
            aria-hidden
            className="h-8 w-8 shrink-0"
          />
          <span className="hidden sm:inline">
            <Wordmark variant="product" size="md" />
          </span>
          <span className="ml-1 hidden text-sm font-medium text-fg-muted sm:inline">
            {t('docs.nav.suffix')}
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <DocsLanguageSwitcher />
          <Link
            href="/login"
            className={
              'text-sm font-medium text-fg-muted transition-colors hover:text-fg ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
              'focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-md px-1'
            }
          >
            {t('docs.nav.openConsole')}
          </Link>
        </div>
      </div>
    </header>
  );
}

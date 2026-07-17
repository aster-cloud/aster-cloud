'use client';

/**
 * Personalized docs home for authenticated readers.
 *
 * Renders four panels:
 *   1. Resume reading — the single most-recent visit (top of localStorage).
 *   2. Recent docs — the next 4 entries by recency.
 *   3. Suggested next step — a capability-driven recommendation.
 *   4. Quick links — Playground / New policy / API keys / Recent traces.
 *
 * Data sources are intentionally light:
 *   - visits come from `useTrackVisit`'s localStorage cache, written
 *     by every docs page on render. Zero network cost, no backend
 *     dependency.
 *   - capabilities come from `useDocsSession()` — the same probe used
 *     by the chrome. We never read `session.user.*` here.
 *
 * Anonymous users never see this component; the parent route bounces
 * them to `/docs/getting-started/overview`. Phase 1's session probe
 * lives client-side, so the `/docs` server component still issues
 * the redirect; this component is mounted client-side on top of the
 * redirect target as the actual personalized surface.
 */

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@aster-cloud/ui';
import { useDocsSession } from '@/lib/docs/use-docs-session';
import { readVisits, type Visit } from '@/lib/docs/use-visit-tracking';
import { docsSidebar } from '@/lib/docs/sidebar';
import { track, Events } from '@/lib/mixpanel';

// O(1) lookup table — the home filters localStorage visits against
// the canonical sidebar so we never render a link to a slug the
// reader can't actually visit. localStorage is client-writable and
// the docs surface could rename slugs across releases; trusting
// the cache without re-validation would surface broken links.
const KNOWN_DOC_SLUGS = new Set<string>(
  docsSidebar.flatMap((s) => s.items.map((i) => i.href)),
);

type Suggestion = {
  /** i18n key for the recommendation card heading. */
  titleKey: string;
  /** i18n key for the supporting copy. */
  descriptionKey: string;
  /** Target route under the app. */
  href: string;
  /** i18n key for the CTA label. */
  ctaKey: string;
};

/**
 * Choose a "do this next" recommendation based on the readers's
 * capabilities. We avoid promises we can't keep — every option
 * either calls the public preview tenant or sends the reader to a
 * surface they're already authorised to use.
 */
function suggestNext(capabilities: ReturnType<typeof useDocsSession> extends infer S
  ? S extends { capabilities: infer C }
    ? C
    : null
  : null,
): Suggestion {
  // Order from cheapest action to richest:
  //   - hasActiveTeam false → prompt them to invite collaborators
  //   - canEditPolicies false → public Playground is the next step
  //   - canViewAudit false → policies editor is the next step
  //   - everything true → audit surface (the read-only deep view)
  if (!capabilities) {
    return {
      titleKey: 'docs.home.suggested.tryPlayground.title',
      descriptionKey: 'docs.home.suggested.tryPlayground.description',
      href: '/policies/new?from=docs&template=policy-evaluate-basic',
      ctaKey: 'docs.home.suggested.tryPlayground.cta',
    };
  }
  if (!capabilities.hasActiveTeam) {
    return {
      titleKey: 'docs.home.suggested.createTeam.title',
      descriptionKey: 'docs.home.suggested.createTeam.description',
      href: '/teams?from=docs',
      ctaKey: 'docs.home.suggested.createTeam.cta',
    };
  }
  if (capabilities.canEditPolicies) {
    return {
      titleKey: 'docs.home.suggested.editPolicy.title',
      descriptionKey: 'docs.home.suggested.editPolicy.description',
      href: '/policies/new?from=docs',
      ctaKey: 'docs.home.suggested.editPolicy.cta',
    };
  }
  return {
    titleKey: 'docs.home.suggested.tryPlayground.title',
    descriptionKey: 'docs.home.suggested.tryPlayground.description',
    href: '/policies/new?from=docs&template=policy-evaluate-basic',
    ctaKey: 'docs.home.suggested.tryPlayground.cta',
  };
}

const QUICK_LINKS: Array<{ key: string; href: string; labelKey: string }> = [
  { key: 'playground', href: '/policies/new?from=docs', labelKey: 'docs.home.quickLinks.playground' },
  { key: 'newPolicy', href: '/policies/new?from=docs', labelKey: 'docs.home.quickLinks.newPolicy' },
  { key: 'apiKeys', href: '/settings/api-keys?from=docs', labelKey: 'docs.home.quickLinks.apiKeys' },
  { key: 'recentTraces', href: '/policies?from=docs&filter=recent', labelKey: 'docs.home.quickLinks.recentTraces' },
];

function trackPanel(panel: string): void {
  track(Events.DOCS_HOME_PERSONALIZED, {
    panel,
  });
}

export function DocsHomeAuthenticated() {
  const t = useTranslations();
  const locale = useLocale();
  const session = useDocsSession();
  const [visits, setVisits] = useState<Visit[]>([]);

  useEffect(() => {
    const all = readVisits().filter((v) => KNOWN_DOC_SLUGS.has(v.slug));
    // 挂载时把外部来源(localStorage 访问记录)读入本地状态——SSR 期无法读取，必须在 effect 中，属合法的外部→状态同步。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisits(all);
    track(Events.DOCS_HOME_PERSONALIZED, {
      panel: 'home_rendered',
      recents_count: all.length,
    });
  }, []);

  const resume = visits[0];
  const recents = visits.slice(1, 5);
  const hasVisits = visits.length > 0;
  const capabilities = session.status === 'authenticated' ? session.capabilities : null;
  const suggestion = suggestNext(capabilities);

  return (
    <section
      aria-label={t('docs.home.ariaLabel')}
      className="docs-home not-prose mx-auto max-w-5xl space-y-10 py-8"
    >
      <header>
        <h1 className="text-3xl font-semibold text-fg">
          {hasVisits ? t('docs.home.heading') : t('docs.home.headingFirstTime')}
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          {hasVisits
            ? t('docs.home.subheading')
            : t('docs.home.subheadingFirstTime')}
        </p>
      </header>

      {resume && (
        <section aria-labelledby="docs-home-resume">
          <h2
            id="docs-home-resume"
            className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted"
          >
            {t('docs.home.resume.title')}
          </h2>
          <Link
            href={`/docs/${resume.slug}`}
            locale={locale}
            onClick={() => trackPanel('resume')}
            className={cn(
              'block rounded-md border border-border bg-bg-soft p-4 transition-colors hover:border-primary hover:bg-bg',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            )}
          >
            <div className="text-base font-medium text-fg">{resume.title}</div>
            <div className="mt-1 text-xs text-fg-muted">{resume.slug}</div>
          </Link>
        </section>
      )}

      {recents.length > 0 && (
        <section aria-labelledby="docs-home-recent">
          <h2
            id="docs-home-recent"
            className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted"
          >
            {t('docs.home.recent.title')}
          </h2>
          <ul role="list" className="grid gap-2 sm:grid-cols-2">
            {recents.map((v) => (
              <li key={v.slug}>
                <Link
                  href={`/docs/${v.slug}`}
                  locale={locale}
                  onClick={() => trackPanel('recent')}
                  className={cn(
                    'block rounded-md border border-border bg-bg p-3 text-sm transition-colors hover:border-primary',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  )}
                >
                  <div className="font-medium text-fg">{v.title}</div>
                  <div className="mt-0.5 text-xs text-fg-muted">{v.slug}</div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="docs-home-suggested">
        <h2
          id="docs-home-suggested"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted"
        >
          {t('docs.home.suggested.heading')}
        </h2>
        <div className="rounded-md border border-border bg-bg-soft p-5">
          <h3 className="text-base font-semibold text-fg">{t(suggestion.titleKey)}</h3>
          <p className="mt-1 text-sm text-fg-muted">{t(suggestion.descriptionKey)}</p>
          <div className="mt-3">
            <Link
              href={suggestion.href}
              locale={locale}
              onClick={() => trackPanel('suggested')}
              className={cn(
                'inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-fg',
                'hover:bg-primary-hover transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              )}
            >
              {t(suggestion.ctaKey)}
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="docs-home-quick-links">
        <h2
          id="docs-home-quick-links"
          className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-muted"
        >
          {t('docs.home.quickLinks.heading')}
        </h2>
        <ul role="list" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map((link) => (
            <li key={link.key}>
              <Link
                href={link.href}
                locale={locale}
                onClick={() => trackPanel(`quick_link_${link.key}`)}
                className={cn(
                  'block rounded-md border border-border bg-bg p-3 text-sm font-medium text-fg transition-colors hover:border-primary hover:bg-bg-soft',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                )}
              >
                {t(link.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

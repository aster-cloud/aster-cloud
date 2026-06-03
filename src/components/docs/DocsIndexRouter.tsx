'use client';

/**
 * Client-side router for the `/docs` entry.
 *
 * Anonymous readers (status === 'anonymous') get the historical
 * behavior: a `router.replace()` to the canonical landing page.
 * The route then matches the `/docs/getting-started/overview` page
 * wrapper and renders normally.
 *
 * Authenticated readers (status === 'authenticated') see the
 * personalized `<DocsHomeAuthenticated>` surface — resume reading,
 * recent docs, suggested next step, quick links.
 *
 * During the `probing` window the route renders nothing (the docs
 * layout's existing skeleton handles the chrome). The probe resolves
 * within a few hundred ms on average; rendering an interim splash
 * would just add a flash.
 *
 * Why this router instead of a server redirect:
 *   - We want PII-free server responses for `/docs`. A server-side
 *     branch on session would force `Vary: Cookie` on the route and
 *     leak the auth state into the response shape.
 *   - Phase 1 already ships the client session probe + provider, so
 *     this hook costs us nothing beyond the routing call.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useDocsSession } from '@/lib/docs/use-docs-session';
import { DocsHomeAuthenticated } from '@/components/docs/DocsHomeAuthenticated';

export function DocsIndexRouter() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations();
  const session = useDocsSession();

  useEffect(() => {
    if (session.status !== 'anonymous') return;
    const target =
      locale === 'en'
        ? '/docs/getting-started/overview'
        : `/${locale}/docs/getting-started/overview`;
    router.replace(target);
  }, [session.status, locale, router]);

  if (session.status === 'authenticated') {
    return <DocsHomeAuthenticated />;
  }
  // Probing or pending-redirect anonymous render: show a small
  // skeleton so the route doesn't flash blank for the few hundred
  // milliseconds the probe takes. The skeleton shape echoes the
  // home heading + a row of cards so the layout doesn't jump
  // afterward.
  return (
    <div
      aria-busy="true"
      aria-label={t('docs.home.loadingAriaLabel')}
      className="docs-home not-prose mx-auto max-w-5xl space-y-6 py-8"
    >
      <div className="h-7 w-1/3 rounded bg-bg-subtle animate-pulse motion-reduce:animate-none" />
      <div className="h-4 w-2/3 rounded bg-bg-subtle animate-pulse motion-reduce:animate-none" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-20 rounded-md bg-bg-subtle animate-pulse motion-reduce:animate-none" />
        <div className="h-20 rounded-md bg-bg-subtle animate-pulse motion-reduce:animate-none" />
      </div>
    </div>
  );
}

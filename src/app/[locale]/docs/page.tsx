import { setRequestLocale } from 'next-intl/server';
import { DocsIndexRouter } from '@/components/docs/DocsIndexRouter';

/**
 * /docs/ entry.
 *
 * Through Phase 5 this redirected unconditionally to the canonical
 * landing (`getting-started/overview`). Phase 6 keeps that behavior
 * for anonymous readers and search engines via a client-side
 * `router.replace()`, but authenticated readers see a personalized
 * docs home (resume reading / recent docs / suggested next step /
 * quick links).
 *
 * Auth gating happens client-side via `useDocsSession()` so the
 * route stays PII-free — the server response shape and CDN cache
 * key are identical for anonymous and authenticated visitors.
 * E2E covers both flows.
 *
 * The E2E spec asserts the route eventually lands on
 * `/docs/getting-started/overview` for anonymous, which the client
 * router still produces — so the existing tests stay green.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DocsIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <DocsIndexRouter />;
}

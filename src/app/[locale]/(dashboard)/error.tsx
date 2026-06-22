'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Container, Stack } from '@/components/ui';

// Route-segment error boundary — Next.js uses this for any throw raised
// by a page.tsx or its descendants. Without it, every server-side throw
// collapses to a generic "Error ID: <random>" with no recovery path.
// `reset` re-renders the segment with fresh server data, so transient
// errors (timeouts, db hiccups) clear without a full reload.
//
// SECURITY: we deliberately do NOT pass `error.message` into the UI.
// On Cloudflare Workers / Next.js production, that string can contain
// stack-trace excerpts, table names, internal IDs — anything the
// underlying throw chose to embed. The user gets `error.digest` (a
// short id Next.js mints + emits to Workers logs) and a generic
// "we logged this" message. The original `error.message` still ends
// up in the Worker log via the console.error below, so on-call can
// pair the user-visible digest with the full failure.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    // Surface raw error in Worker logs so log lookups remain possible
    // even when the user sees a friendly message. Keep the message in
    // logs only — never render it.
    console.error('[dashboard-error]', error.digest, error.message);
  }, [error]);

  return (
    <Container size="xl" className="py-12">
      <Stack gap={4}>
        <h1 className="font-display text-2xl font-semibold text-fg">
          {t('somethingWrong')}
        </h1>
        <p className="text-sm text-fg-muted">{t('somethingWrongBody')}</p>
        {error.digest && (
          <p className="font-mono text-xs text-fg-subtle">
            {t('errorId')}: {error.digest}
          </p>
        )}
        <div>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg-muted focus-visible:outline-none focus-visible:shadow-ring"
          >
            {t('tryAgain')}
          </button>
        </div>
      </Stack>
    </Container>
  );
}

'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ErrorState } from '@/components/feedback/error-state';
import { Container, Stack } from '@/components/ui';

// Route-segment error boundary — Next.js uses this for any throw raised
// by a page.tsx or its descendants. Without it, every server-side throw
// collapses to a generic "Error ID: <random>" with no recovery path.
// `reset` re-renders the segment with fresh server data, so transient
// errors (timeouts, db hiccups) clear without a full reload.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  // Surface the digest in Worker logs so log lookups remain possible
  // even when the user sees a friendly message.
  useEffect(() => {
    console.error('[dashboard-error]', error.digest, error.message);
  }, [error]);

  return (
    <Container size="base" className="py-12">
      <Stack gap={4}>
        <h1 className="font-display text-2xl font-semibold text-fg">
          {t('somethingWrong')}
        </h1>
        <ErrorState error={error.message || t('somethingWrong')} onRetry={reset} />
      </Stack>
    </Container>
  );
}

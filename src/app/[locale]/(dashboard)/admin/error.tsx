'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Container, Stack } from '@/components/ui';

/**
 * Route-segment error boundary scoped to /admin/*.
 *
 * Lives one level deeper than the (dashboard)/error.tsx so admin-tool
 * failures (Risk-tier 500, AI Circuit Breaker 500, license endpoint
 * outage) render an admin-themed page that:
 *   - never leaks `error.message` into the UI (it can contain stack-
 *     trace excerpts / table names / internal IDs)
 *   - surfaces `error.digest` so on-call can correlate with Worker logs
 *   - offers Retry + "Back to Admin Overview" + Support escalation
 *
 * The parent (dashboard) shell catches anything this boundary doesn't.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    // Keep raw failure in Worker logs only; never render.
    console.error('[admin-error]', error.digest, error.message);
  }, [error]);

  return (
    <Container size="xl" className="py-12">
      <Stack gap={4}>
        <h1 className="font-display text-2xl font-semibold text-fg">
          {t('admin.errorBoundary.title')}
        </h1>
        <p className="text-sm text-fg-muted">
          {t('admin.errorBoundary.body')}
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-fg-subtle">
            {t('common.errorId')}: {error.digest}
          </p>
        )}
        <Stack direction="row" gap={3} className="pt-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg-muted focus-visible:outline-none focus-visible:shadow-ring"
          >
            {t('common.tryAgain')}
          </button>
          <Link
            href="/admin"
            className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg-subtle focus-visible:outline-none focus-visible:shadow-ring"
          >
            {t('admin.errorBoundary.backToOverview')}
          </Link>
        </Stack>
      </Stack>
    </Container>
  );
}

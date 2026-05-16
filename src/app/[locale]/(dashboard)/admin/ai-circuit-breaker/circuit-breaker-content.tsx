'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CardDescription,
  ConfirmDialog,
  Container,
  PageHeader,
  Stack,
  StatCard,
  toast,
} from '@/components/ui';
import { Activity, RefreshCw } from 'lucide-react';
import { useApi } from '@/lib/api';

type CircuitState = 'OPEN' | 'CLOSED_FREE' | 'CLOSED_TRIAL' | 'CLOSED_ALL';

interface CircuitStatus {
  today_cents: number;
  today_usd: string;
  state: CircuitState;
  thresholds: {
    free_stop_usd: number;
    trial_stop_usd: number;
  };
}

/**
 * Admin console for the LLM circuit breaker.
 *
 * Backend exposes GET (status) + POST { action: 'release' } at
 * /api/admin/ai-circuit-breaker. This page surfaces:
 *
 *   - Today's platform spend as a stat card so the admin sees how
 *     close the auto-trip thresholds are.
 *   - Current circuit state as a badge (OPEN / CLOSED_FREE /
 *     CLOSED_TRIAL / CLOSED_ALL) with localized labels.
 *   - Thresholds the auto-tripper compares against.
 *   - Manual Release button (gated by ConfirmDialog) that POSTs
 *     to /release the circuit, used when an incident is over but
 *     the auto-trip cooldown hasn't elapsed yet.
 *
 * useApi caches the status for 30 s; an explicit "Refresh" button
 * re-fetches without waiting.
 */
export function CircuitBreakerContent() {
  const t = useTranslations('settings.aiCircuitBreakerPage');
  const tCommon = useTranslations('common');
  const { data, error, isLoading, mutate } = useApi<CircuitStatus>(
    '/api/admin/ai-circuit-breaker',
    { refreshInterval: 30_000 },
  );
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);

  const stateLabel = (() => {
    switch (data?.state) {
      case 'OPEN':
        return t('stateOpen');
      case 'CLOSED_FREE':
        return t('stateClosedFree');
      case 'CLOSED_TRIAL':
        return t('stateClosedTrial');
      case 'CLOSED_ALL':
        return t('stateClosedAll');
      default:
        return '—';
    }
  })();
  const stateVariant = data?.state === 'OPEN' ? 'success' : 'danger';

  const release = async () => {
    setIsReleasing(true);
    try {
      const res = await fetch('/api/admin/ai-circuit-breaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(t('releaseFailure', { error: body.error || res.status }));
        return;
      }
      toast.success(t('releaseSuccess'));
      setConfirmRelease(false);
      mutate();
    } finally {
      setIsReleasing(false);
    }
  };

  return (
    <Container size="base" className="py-6 sm:py-10">
      <Stack gap={6}>
        <PageHeader
          breadcrumbs={
            <Breadcrumbs items={[{ label: t('breadcrumb') }]} />
          }
          title={t('title')}
          subtitle={t('subtitle')}
          action={
            <Button
              variant="secondary"
              onClick={() => mutate()}
              disabled={isLoading}
            >
              <RefreshCw aria-hidden className="size-4" />
              {t('refresh')}
            </Button>
          }
        />

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger"
          >
            {error.message}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            label={t('todaySpend')}
            value={data ? t('spendUsd', { usd: data.today_usd }) : '—'}
            icon={<Activity className="size-5" />}
            tone={data?.state !== 'OPEN' ? 'danger' : 'primary'}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('currentState')}</CardTitle>
              <CardDescription>
                <Badge variant={stateVariant}>{stateLabel}</Badge>
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('thresholds')}</CardTitle>
          </CardHeader>
          <CardBody>
            <Stack direction="row" gap={6} wrap>
              <span className="text-sm text-fg-muted">
                {t('thresholdFree', {
                  usd: data ? data.thresholds.free_stop_usd.toFixed(2) : '—',
                })}
              </span>
              <span className="text-sm text-fg-muted">
                {t('thresholdTrial', {
                  usd: data ? data.thresholds.trial_stop_usd.toFixed(2) : '—',
                })}
              </span>
            </Stack>
          </CardBody>
        </Card>

        <Card className="border-danger/40">
          <CardHeader>
            <CardTitle className="text-base text-danger">
              {t('release')}
            </CardTitle>
            <CardDescription>{t('releaseConfirmBody')}</CardDescription>
          </CardHeader>
          <CardBody>
            <Button
              variant="destructive"
              onClick={() => setConfirmRelease(true)}
              disabled={!data || data.state === 'OPEN'}
            >
              {t('release')}
            </Button>
          </CardBody>
        </Card>
      </Stack>

      <ConfirmDialog
        isOpen={confirmRelease}
        title={t('releaseConfirmTitle')}
        description={t('releaseConfirmBody')}
        confirmLabel={t('releaseConfirmAction')}
        cancelLabel={t('releaseConfirmCancel')}
        variant="danger"
        isLoading={isReleasing}
        onConfirm={release}
        onCancel={() => !isReleasing && setConfirmRelease(false)}
      />
      {/* tCommon kept for future use; suppress unused lint */}
      <span hidden>{tCommon('loading')}</span>
    </Container>
  );
}

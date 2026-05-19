/**
 * Client component for the renewal portal happy-path view.
 *
 * Once the server confirms the token is valid we render the license summary
 * + a single primary action (Stripe checkout). The action POSTs to
 * /api/renew/[token]/checkout which creates a one-time-payment session and
 * returns the Stripe-hosted URL; we then redirect.
 *
 * We keep this thin on purpose — license selection (term / tier) is *not*
 * exposed here. v3.0 only supports "renew current configuration" — a
 * tier change goes through sales. This keeps the UI a one-button screen
 * and avoids us having to validate cross-tier downgrades against current
 * usage.
 */

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
  rawToken: string;
  licenseId: string;
  customer: string;
  expiresAt: string;
  deploymentLabel: string;
}

export function RenewalPortal({ rawToken, licenseId, customer, expiresAt, deploymentLabel }: Props) {
  const t = useTranslations('renewal.portal');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout(): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/renew/${encodeURIComponent(rawToken)}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setError(body.error ?? t('checkout.genericError'));
        setIsSubmitting(false);
        return;
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('checkout.genericError'));
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 px-6 py-12">
      <header className="text-center">
        <h1 className="text-3xl font-semibold">{t('valid.title')}</h1>
        <p className="mt-2 text-fg-muted">{t('valid.subtitle')}</p>
      </header>

      <section className="w-full rounded-lg border border-border bg-bg-subtle p-5">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-fg-muted">{t('summary.customer')}</dt>
          <dd className="font-medium">{customer}</dd>

          <dt className="text-fg-muted">{t('summary.licenseId')}</dt>
          <dd className="font-mono text-xs">{licenseId}</dd>

          <dt className="text-fg-muted">{t('summary.deployment')}</dt>
          <dd className="font-medium">{deploymentLabel}</dd>

          <dt className="text-fg-muted">{t('summary.currentExpiry')}</dt>
          <dd className="font-medium">{new Date(expiresAt).toISOString().slice(0, 10)}</dd>
        </dl>
      </section>

      <button
        type="button"
        onClick={handleCheckout}
        disabled={isSubmitting}
        className="w-full rounded-md bg-primary px-4 py-3 text-base font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? t('checkout.starting') : t('checkout.continue')}
      </button>

      {error && (
        <p role="alert" className="text-sm text-rose-400">
          {error}
        </p>
      )}

      <p className="text-center text-xs text-fg-muted">
        {t('valid.footer')}
      </p>
    </main>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Breadcrumbs,
  ConfirmDialog,
  Container,
  Input,
  Label,
  PageHeader,
  Select,
} from '@/components/ui';
import { extractErrorMessage } from '@/lib/api/error-envelope';

interface BYOKBinding {
  id: string;
  provider: string;
  keyHint: string;
  active: boolean;
  lastUsedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  createdAt: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  vertex: 'Google Vertex AI',
};

interface AiKeysContentProps {
  initialBindings: BYOKBinding[];
  locale: string;
}

/**
 * Bring-Your-Own-Key settings — fully i18n'd in EN / ZH / DE.
 *
 * The previous implementation had the entire UI (labels, errors,
 * confirm dialog, "Why use BYOK?" explainer) hard-coded in Chinese,
 * which made the page unreadable for English / German users even
 * when they switched locale. Strings now flow through next-intl
 * (settings.aiKeysPage.*) and provider names stay as proper nouns.
 */
export function AiKeysContent({ initialBindings, locale }: AiKeysContentProps) {
  const t = useTranslations('settings.aiKeysPage');
  const tSettings = useTranslations('settings');
  const [bindings, setBindings] = useState<BYOKBinding[]>(initialBindings);
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'vertex'>(
    'openai',
  );
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [revokeProvider, setRevokeProvider] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const refresh = async () => {
    const r = await fetch('/api/user/ai-keys');
    if (r.ok) {
      const data = await r.json();
      setBindings(data.bindings ?? []);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (apiKey.length < 20) {
      setError(t('keyTooShort'));
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/user/ai-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(extractErrorMessage(data) || t('saveFailed', { status: r.status }));
        return;
      }
      setApiKey('');
      setSuccess(
        t('saved', { provider: PROVIDER_LABELS[provider] ?? provider }),
      );
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = (p: string) => setRevokeProvider(p);

  const confirmRevoke = async () => {
    if (!revokeProvider) return;
    setIsRevoking(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/user/ai-keys?provider=${encodeURIComponent(revokeProvider)}`,
        { method: 'DELETE' },
      );
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(extractErrorMessage(data) || t('revokeFailed', { status: r.status }));
        return;
      }
      await refresh();
    } finally {
      setIsRevoking(false);
      setRevokeProvider(null);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return t('never');
    return new Date(iso).toLocaleDateString(locale);
  };

  return (
    <Container size="xl" className="py-6 sm:py-10">
      {/* deep 页：保留 Breadcrumbs（settings → AI keys），放进 PageHeader 的 breadcrumbs 槽。 */}
      <PageHeader
        title={t('title')}
        subtitle={
          <>
            {t('subtitle')}{' '}
            <Link
              href={`/${locale}/dashboard`}
              className="ml-2 text-primary hover:underline"
            >
              {t('viewUsage')}
            </Link>
          </>
        }
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: tSettings('title'), href: '/settings' },
              { label: t('breadcrumb') },
            ]}
          />
        }
        className="mb-6"
      />

      <section className="mt-6 rounded-lg border border-border bg-bg p-6">
        <h2 className="text-lg font-semibold text-fg">{t('addTitle')}</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Use the @aster-cloud/ui primitives so the form inputs match
              the design-system standard (token-driven border, focus ring,
              size variants) — replaces the previous hand-rolled
              `<input>` / `<select>` markup that diverged from
              Storybook's component contracts. */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-keys-provider">{t('provider')}</Label>
            <Select
              id="ai-keys-provider"
              value={provider}
              onChange={(e) =>
                setProvider(
                  e.target.value as 'openai' | 'anthropic' | 'vertex',
                )
              }
            >
              <option value="openai">{t('providerOpenai')}</option>
              <option value="anthropic">{t('providerAnthropic')}</option>
              <option value="vertex">{t('providerVertex')}</option>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-keys-secret">{t('apiKey')}</Label>
            <Input
              id="ai-keys-secret"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              placeholder="sk-..."
              required
            />
            <p className="text-xs text-fg-muted">{t('apiKeyHint')}</p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? t('saving') : t('save')}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-bg p-6">
        <h2 className="text-lg font-semibold text-fg">{t('boundTitle')}</h2>
        {bindings.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{t('noneBound')}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-fg-muted">
                  <th className="pb-2 text-left">{t('thProvider')}</th>
                  <th className="pb-2 text-left">{t('thKeyHint')}</th>
                  <th className="pb-2 text-left">{t('thStatus')}</th>
                  <th className="pb-2 text-left">{t('thLastUsed')}</th>
                  <th className="pb-2 text-left">{t('thCreated')}</th>
                  <th className="pb-2 text-left">{t('thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {bindings.map((b) => (
                  <tr key={b.id} className="border-b border-border">
                    <td className="py-3">
                      {PROVIDER_LABELS[b.provider] ?? b.provider}
                    </td>
                    <td className="py-3 font-mono text-xs">****{b.keyHint}</td>
                    <td className="py-3">
                      {b.active ? (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          {t('statusActive')}
                        </span>
                      ) : (
                        <span className="rounded bg-bg-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
                          {t('statusDisabled')}
                        </span>
                      )}
                      {b.lastError && (
                        <span
                          className="ml-2 cursor-help rounded bg-red-100 px-2 py-0.5 text-xs text-red-700"
                          title={b.lastError}
                        >
                          {t('lastError')}
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-fg-muted">
                      {formatDate(b.lastUsedAt)}
                    </td>
                    <td className="py-3 text-fg-muted">
                      {formatDate(b.createdAt)}
                    </td>
                    <td className="py-3">
                      <button
                        onClick={() => handleRevoke(b.provider)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {t('revoke')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-bg-subtle p-6">
        <h3 className="text-base font-semibold text-fg">{t('whyTitle')}</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-fg">
          <li>{t('whyQuota')}</li>
          <li>{t('whyBilling')}</li>
          <li>{t('whyCompliance')}</li>
        </ul>
      </section>

      <ConfirmDialog
        isOpen={revokeProvider !== null}
        title={t('revokeDialogTitle')}
        description={
          revokeProvider
            ? t('revokeDialogBody', {
                provider: PROVIDER_LABELS[revokeProvider] ?? revokeProvider,
              })
            : ''
        }
        confirmLabel={t('revokeDialogConfirm')}
        cancelLabel={t('revokeDialogCancel')}
        variant="danger"
        isLoading={isRevoking}
        onConfirm={confirmRevoke}
        onCancel={() => !isRevoking && setRevokeProvider(null)}
      />
    </Container>
  );
}

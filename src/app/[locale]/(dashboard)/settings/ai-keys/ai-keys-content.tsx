'use client';

import { useEffect, useState } from 'react';
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
  providerUrl: string | null;
  tokenQuota: number | null;
  expiresAt: string | null;
  usedTokensThisMonth: number;
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
  // BYOK 增强：可选 providerUrl / token 额度 / 失效日期。空字符串 = 不设置。
  const [providerUrl, setProviderUrl] = useState('');
  const [tokenQuota, setTokenQuota] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hydration-safe：toLocaleDateString/toLocaleString 在 SSR(Node) 与 CSR(浏览器) 的
  // 时区/locale 数据不同 → 首帧文本不一致 → React #418 hydration mismatch。用 mounted gate：
  // 服务端 + 客户端首帧都渲染确定性内容（ISO 日期 / 原始数字），挂载后再切 locale 格式。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [success, setSuccess] = useState<string | null>(null);
  const [revokeProvider, setRevokeProvider] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  // 行内编辑（改额度上限 / 失效日期，不重输 key）：editingId=当前编辑的 binding，null=无。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuota, setEditQuota] = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [resetConfirmId, setResetConfirmId] = useState<string | null>(null);

  const refresh = async () => {
    const r = await fetch('/api/user/ai-keys');
    if (r.ok) {
      const data = await r.json();
      setBindings(data.bindings ?? []);
    }
  };

  const startEdit = (b: BYOKBinding) => {
    setError(null);
    setSuccess(null);
    setEditingId(b.id);
    setEditQuota(b.tokenQuota != null ? String(b.tokenQuota) : '');
    // date input 要 YYYY-MM-DD；从 ISO 截前 10 位。
    setEditExpiry(b.expiresAt ? b.expiresAt.slice(0, 10) : '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditQuota('');
    setEditExpiry('');
  };

  const saveEdit = async (b: BYOKBinding) => {
    setError(null);
    setSuccess(null);
    // tokenQuota：空=清空（改无限，传 null）；否则须正整数。
    let quota: number | null = null;
    if (editQuota.trim() !== '') {
      const n = Number(editQuota);
      if (!Number.isInteger(n) || n <= 0) {
        setError(t('quotaInvalid'));
        return;
      }
      quota = n;
    }
    // expiresAt 仅在用户**真的改了**失效日期时才提交（省略 = 服务端不动该列）。
    // 关键边界（Codex 审查）：若 key 已过期、用户只想改额度，重发那个过期日期会被服务端
    // 「必须未来时间」拒绝。故比较当前输入与原值（都归一到 YYYY-MM-DD），未改则不带 expiresAt。
    const originalExpiryDay = b.expiresAt ? b.expiresAt.slice(0, 10) : '';
    const expiryChanged = editExpiry !== originalExpiryDay;
    const payload: {
      id: string;
      action: 'update';
      tokenQuota: number | null;
      expiresAt?: string | null;
    } = { id: b.id, action: 'update', tokenQuota: quota };
    if (expiryChanged) {
      // 空=永不过期（null）；否则当天 UTC 结束前（未来时间）。
      payload.expiresAt = editExpiry ? new Date(editExpiry + 'T23:59:59Z').toISOString() : null;
    }

    setRowBusy(b.id);
    try {
      const r = await fetch('/api/user/ai-keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(extractErrorMessage(data) || t('saveFailed', { status: r.status }));
        return;
      }
      setSuccess(t('editSaved'));
      cancelEdit();
      await refresh();
    } finally {
      setRowBusy(null);
    }
  };

  const confirmResetQuota = async () => {
    if (!resetConfirmId) return;
    setError(null);
    setSuccess(null);
    setRowBusy(resetConfirmId);
    try {
      const r = await fetch('/api/user/ai-keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resetQuota' }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(extractErrorMessage(data) || t('resetFailed', { status: r.status }));
        return;
      }
      setSuccess(t('quotaReset'));
      await refresh();
    } finally {
      setRowBusy(null);
      setResetConfirmId(null);
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
    // 本地校验 tokenQuota（正整数）——服务端也校验,这里给即时反馈。
    let quotaNum: number | null = null;
    if (tokenQuota.trim() !== '') {
      const n = Number(tokenQuota);
      if (!Number.isInteger(n) || n <= 0) {
        setError(t('quotaInvalid'));
        return;
      }
      quotaNum = n;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/user/ai-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey,
          providerUrl: providerUrl.trim() || null,
          tokenQuota: quotaNum,
          // date input 是 YYYY-MM-DD;转成当天 UTC 结束前的 ISO（未来时间）。
          expiresAt: expiresAt ? new Date(expiresAt + 'T23:59:59Z').toISOString() : null,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(extractErrorMessage(data) || t('saveFailed', { status: r.status }));
        return;
      }
      setApiKey('');
      setProviderUrl('');
      setTokenQuota('');
      setExpiresAt('');
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
    // 挂载前用确定性 ISO 日期（YYYY-MM-DD，SSR/CSR 一致）；挂载后切 locale 本地格式。
    if (!mounted) return iso.slice(0, 10);
    return new Date(iso).toLocaleDateString(locale);
  };
  // 数字千分位同理 hydration-safe：挂载前用原始数字串，挂载后用 locale 格式。
  const formatNum = (n: number) => (mounted ? n.toLocaleString(locale) : String(n));

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

          {/* BYOK 可选高级设置：自定义 Provider URL / token 额度 / 失效日期 */}
          <div className="flex flex-col gap-4 rounded-md border border-border p-4">
            <p className="text-sm font-medium text-fg-muted">{t('advancedTitle')}</p>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-keys-url">{t('providerUrl')}</Label>
              <Input
                id="ai-keys-url"
                type="url"
                value={providerUrl}
                onChange={(e) => setProviderUrl(e.target.value)}
                autoComplete="off"
                placeholder="https://api.openai.com/v1"
              />
              <p className="text-xs text-fg-muted">{t('providerUrlHint')}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-keys-quota">{t('tokenQuota')}</Label>
              <Input
                id="ai-keys-quota"
                type="number"
                min="1"
                step="1"
                value={tokenQuota}
                onChange={(e) => setTokenQuota(e.target.value)}
                placeholder={t('tokenQuotaPlaceholder')}
              />
              <p className="text-xs text-fg-muted">{t('tokenQuotaHint')}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ai-keys-expiry">{t('expiresAt')}</Label>
              <Input
                id="ai-keys-expiry"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="text-xs text-fg-muted">{t('expiresAtHint')}</p>
            </div>
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
                  <th className="pb-2 text-left">{t('thQuota')}</th>
                  <th className="pb-2 text-left">{t('thExpiry')}</th>
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
                      {editingId === b.id ? (
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={editQuota}
                          onChange={(e) => setEditQuota(e.target.value)}
                          placeholder={t('quotaUnlimited')}
                          className="w-28"
                          aria-label={t('tokenQuota')}
                        />
                      ) : b.tokenQuota == null ? (
                        t('quotaUnlimited')
                      ) : (
                        t('quotaUsage', {
                          used: formatNum(b.usedTokensThisMonth),
                          quota: formatNum(b.tokenQuota),
                        })
                      )}
                    </td>
                    <td className="py-3 text-fg-muted">
                      {editingId === b.id ? (
                        <Input
                          type="date"
                          value={editExpiry}
                          onChange={(e) => setEditExpiry(e.target.value)}
                          className="w-40"
                          aria-label={t('expiresAt')}
                        />
                      ) : b.expiresAt ? (
                        formatDate(b.expiresAt)
                      ) : (
                        t('noExpiry')
                      )}
                    </td>
                    <td className="py-3 text-fg-muted">
                      {formatDate(b.lastUsedAt)}
                    </td>
                    <td className="py-3 text-fg-muted">
                      {formatDate(b.createdAt)}
                    </td>
                    <td className="py-3">
                      {editingId === b.id ? (
                        <div className="flex gap-3">
                          <button
                            onClick={() => saveEdit(b)}
                            disabled={rowBusy === b.id}
                            className="text-xs text-primary hover:underline disabled:opacity-50"
                          >
                            {rowBusy === b.id ? t('saving') : t('editSave')}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={rowBusy === b.id}
                            className="text-xs text-fg-muted hover:underline disabled:opacity-50"
                          >
                            {t('editCancel')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <button
                            onClick={() => startEdit(b)}
                            className="text-xs text-primary hover:underline"
                          >
                            {t('edit')}
                          </button>
                          <button
                            onClick={() => setResetConfirmId(b.id)}
                            className="text-xs text-primary hover:underline"
                          >
                            {t('resetQuota')}
                          </button>
                          <button
                            onClick={() => handleRevoke(b.provider)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            {t('delete')}
                          </button>
                        </div>
                      )}
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

      <ConfirmDialog
        isOpen={resetConfirmId !== null}
        title={t('resetDialogTitle')}
        description={t('resetDialogBody')}
        confirmLabel={t('resetDialogConfirm')}
        cancelLabel={t('resetDialogCancel')}
        isLoading={rowBusy !== null && rowBusy === resetConfirmId}
        onConfirm={confirmResetQuota}
        onCancel={() => rowBusy === null && setResetConfirmId(null)}
      />
    </Container>
  );
}

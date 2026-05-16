'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui';

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

export function AiKeysContent({ initialBindings, locale }: AiKeysContentProps) {
  const [bindings, setBindings] = useState<BYOKBinding[]>(initialBindings);
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'vertex'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Branded revoke confirmation — replaces window.confirm() so the
  // dialog matches the rest of the dashboard chrome and isn't locked
  // to the OS-default Chinese-only string this page used to hard-code.
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
      setError('API key 太短，至少 20 个字符。');
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
        setError(data.error || `保存失败 (HTTP ${r.status})`);
        return;
      }
      setApiKey('');
      setSuccess(`${PROVIDER_LABELS[provider]} key 已保存。`);
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = (p: string) => {
    setRevokeProvider(p);
  };

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
        setError(data.error || `撤销失败 (HTTP ${r.status})`);
        return;
      }
      await refresh();
    } finally {
      setIsRevoking(false);
      setRevokeProvider(null);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleDateString();
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: 'Settings', href: '/settings' },
          { label: 'AI Keys (BYOK)' },
        ]}
      />

      <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">AI Keys (Bring Your Own Key)</h1>
      <p className="mt-1 text-sm text-fg-muted">
        绑定您自己的 OpenAI / Anthropic / Vertex AI key，调用 AI 功能时使用您自己的额度，
        不受平台 LLM 月度配额限制。
        <Link href={`/${locale}/dashboard`} className="ml-2 text-primary hover:underline">
          查看 AI 用量 →
        </Link>
      </p>

      <section className="mt-6 rounded-lg border border-border bg-bg p-6">
        <h2 className="text-lg font-semibold text-fg">添加 BYOK Key</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'openai' | 'anthropic' | 'vertex')}
              className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary focus:ring-primary"
            >
              <option value="openai">OpenAI (sk-...)</option>
              <option value="anthropic">Anthropic (sk-ant-...)</option>
              <option value="vertex">Google Vertex AI</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              placeholder="sk-..."
              className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary focus:ring-primary"
              required
            />
            <p className="mt-1 text-xs text-fg-muted">
              Key 通过 pgcrypto 加密保存；明文不可恢复。
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</div>
          )}
          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">{success}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save Key'}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-bg p-6">
        <h2 className="text-lg font-semibold text-fg">已绑定的 Keys</h2>
        {bindings.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">未绑定任何 BYOK key。AI 调用会使用平台月度配额。</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-fg-muted">
                <th className="pb-2 text-left">Provider</th>
                <th className="pb-2 text-left">Key Hint</th>
                <th className="pb-2 text-left">Status</th>
                <th className="pb-2 text-left">Last Used</th>
                <th className="pb-2 text-left">Created</th>
                <th className="pb-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr key={b.id} className="border-b border-border">
                  <td className="py-3">{PROVIDER_LABELS[b.provider] ?? b.provider}</td>
                  <td className="py-3 font-mono text-xs">****{b.keyHint}</td>
                  <td className="py-3">
                    {b.active ? (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Active
                      </span>
                    ) : (
                      <span className="rounded bg-bg-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
                        Disabled
                      </span>
                    )}
                    {b.lastError && (
                      <span
                        className="ml-2 cursor-help rounded bg-red-100 px-2 py-0.5 text-xs text-red-700"
                        title={b.lastError}
                      >
                        Last error
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-fg-muted">{formatDate(b.lastUsedAt)}</td>
                  <td className="py-3 text-fg-muted">{formatDate(b.createdAt)}</td>
                  <td className="py-3">
                    <button
                      onClick={() => handleRevoke(b.provider)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-bg-subtle p-6">
        <h3 className="text-base font-semibold text-fg">为什么用 BYOK？</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-fg">
          <li>不消耗平台月度 AI 配额（Free 20 / Pro 500 / Team 500/seat）</li>
          <li>调用直接走您 provider 账户结算，使用您的速率限制</li>
          <li>合规场景下数据不落到第三方（Vertex 部署在您 GCP 项目内）</li>
        </ul>
      </section>

      <ConfirmDialog
        isOpen={revokeProvider !== null}
        title="撤销 BYOK key"
        description={
          revokeProvider
            ? `确定要撤销 ${PROVIDER_LABELS[revokeProvider] ?? revokeProvider} 的 BYOK key 吗？此后会回到平台 LLM 配额。`
            : ''
        }
        confirmLabel="撤销"
        cancelLabel="取消"
        variant="danger"
        isLoading={isRevoking}
        onConfirm={confirmRevoke}
        onCancel={() => !isRevoking && setRevokeProvider(null)}
      />
    </div>
  );
}

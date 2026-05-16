'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Breadcrumbs } from '@/components/ui';

interface RiskRow {
  id: string;
  email: string | null;
  emailNormalized: string | null;
  plan: string;
  riskTier: number;
  riskTierReason: string | null;
  priorPurgeCount: number;
  reactivationCount: number;
  createdAt: string;
  deletedAt: string | null;
}

type SortKey = 'riskTier' | 'createdAt' | 'priorPurgeCount';

const TIER_LABELS: Record<number, string> = {
  0: 'trusted',
  1: 'normal',
  2: 'elevated',
  3: 'high',
  4: 'hard',
};

const TIER_COLORS: Record<number, string> = {
  0: 'bg-bg-muted text-fg',
  1: 'bg-yellow-100 text-yellow-800',
  2: 'bg-orange-100 text-orange-800',
  3: 'bg-red-100 text-red-800',
  4: 'bg-red-200 text-red-900 font-semibold',
};

export function RiskTierAdminContent() {
  const t = useTranslations('admin.riskTier');
  const [rows, setRows] = useState<RiskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minTier, setMinTier] = useState<number>(1);
  const [sortBy, setSortBy] = useState<SortKey>('riskTier');

  const [overrideOf, setOverrideOf] = useState<RiskRow | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/risk-tier?minTier=${minTier}&limit=200`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { users: RiskRow[] };
      setRows(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [minTier]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const sorted = [...rows].sort((a, b) => {
    if (sortBy === 'riskTier') return b.riskTier - a.riskTier;
    if (sortBy === 'priorPurgeCount') return b.priorPurgeCount - a.priorPurgeCount;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const distribution: Record<number, number> = {};
  for (const r of rows) distribution[r.riskTier] = (distribution[r.riskTier] ?? 0) + 1;

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <Breadcrumbs
          className="mb-2"
          items={[
            { label: 'Admin' },
            { label: t('title') },
          ]}
        />
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
      </header>

      <section className="mb-6 grid gap-3 grid-cols-2 sm:grid-cols-5">
        {[1, 2, 3, 4].map((tier) => (
          <div
            key={tier}
            className={`rounded-lg border border-border p-4 dark:border-gray-700 ${TIER_COLORS[tier]}`}
          >
            <p className="text-xs uppercase tracking-wider">
              tier {tier} ({TIER_LABELS[tier]})
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {distribution[tier] ?? 0}
            </p>
          </div>
        ))}
        <div className="rounded-lg border border-border p-4 dark:border-gray-700">
          <p className="text-xs uppercase tracking-wider text-fg-muted">{t('total')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{rows.length}</p>
        </div>
      </section>

      <section className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          {t('filters.minTier')}{' '}
          <select
            value={minTier}
            onChange={(e) => setMinTier(Number(e.target.value))}
            className="ml-1 rounded border border-border-strong px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
          >
            {[1, 2, 3, 4].map((v) => (
              <option key={v} value={v}>
                ≥ {v} ({TIER_LABELS[v]})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t('filters.sortBy')}{' '}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="ml-1 rounded border border-border-strong px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="riskTier">{t('filters.byTier')}</option>
            <option value="createdAt">{t('filters.byCreated')}</option>
            <option value="priorPurgeCount">{t('filters.byPurges')}</option>
          </select>
        </label>
        <button
          onClick={fetchRows}
          className="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
        >
          {t('refresh')}
        </button>
      </section>

      {loading && <p className="text-sm text-fg-muted">{t('loading')}</p>}
      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-border dark:border-gray-700">
          <table className="min-w-full divide-y divide-border dark:divide-gray-700">
            <thead className="bg-bg-subtle dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('table.tier')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('table.email')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('table.plan')}
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('table.priorPurges')}
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('table.reactivations')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('table.reason')}
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('table.created')}
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-gray-700">
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-fg-muted">
                    {t('empty')}
                  </td>
                </tr>
              )}
              {sorted.map((r) => (
                <tr key={r.id} className={r.deletedAt ? 'bg-bg-subtle/50 dark:bg-gray-900/40' : ''}>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs ${TIER_COLORS[r.riskTier]}`}>
                      {r.riskTier} {TIER_LABELS[r.riskTier]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm">
                    <div className="font-mono">{r.email ?? '—'}</div>
                    {r.emailNormalized && r.emailNormalized !== r.email && (
                      <div className="font-mono text-xs text-fg-muted">↳ {r.emailNormalized}</div>
                    )}
                    {r.deletedAt && (
                      <div className="mt-0.5 text-xs text-red-600">
                        {t('table.tombstoned')}: {new Date(r.deletedAt).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm">{r.plan}</td>
                  <td className="px-3 py-2 text-right text-sm tabular-nums">{r.priorPurgeCount}</td>
                  <td className="px-3 py-2 text-right text-sm tabular-nums">{r.reactivationCount}</td>
                  <td className="px-3 py-2 text-xs font-mono">{r.riskTierReason ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setOverrideOf(r)}
                      className="rounded bg-bg-muted px-2 py-1 text-xs font-medium hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
                    >
                      {t('table.override')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {overrideOf && (
        <OverrideModal
          row={overrideOf}
          onClose={() => setOverrideOf(null)}
          onDone={() => {
            setOverrideOf(null);
            fetchRows();
          }}
        />
      )}
    </div>
  );
}

function OverrideModal({
  row,
  onClose,
  onDone,
}: {
  row: RiskRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('admin.riskTier.override');
  const [newTier, setNewTier] = useState<number>(0);
  const [ticketId, setTicketId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/risk-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: row.id,
          newTier,
          ticketId: ticketId.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-bg p-6 shadow-xl dark:bg-gray-900">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <p className="mt-2 text-sm text-fg-muted dark:text-fg-subtle">
          <span className="font-mono">{row.email ?? row.id}</span>
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {t('currentTier')}: <span className={`rounded px-1 ${TIER_COLORS[row.riskTier]}`}>
            {row.riskTier} {TIER_LABELS[row.riskTier]}
          </span>
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            {t('newTier')}
            <select
              value={newTier}
              onChange={(e) => setNewTier(Number(e.target.value))}
              className="mt-1 block w-full rounded border border-border-strong px-2 py-1 dark:border-gray-700 dark:bg-gray-800"
            >
              {[0, 1, 2, 3, 4].map((v) => (
                <option key={v} value={v}>
                  {v} {TIER_LABELS[v]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            {t('ticketId')} <span className="text-xs text-fg-muted">{t('ticketIdHint')}</span>
            <input
              type="text"
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              placeholder="SUP-1234"
              className="mt-1 block w-full rounded border border-border-strong px-2 py-1 dark:border-gray-700 dark:bg-gray-800"
            />
          </label>

          <label className="block text-sm">
            {t('note')}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t('notePlaceholder')}
              className="mt-1 block w-full rounded border border-border-strong px-2 py-1 dark:border-gray-700 dark:bg-gray-800"
            />
          </label>

          {error && (
            <p className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded px-3 py-1.5 text-sm hover:bg-bg-muted dark:hover:bg-gray-800"
          >
            {t('cancel')}
          </button>
          <button
            onClick={submit}
            disabled={submitting || newTier === row.riskTier}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

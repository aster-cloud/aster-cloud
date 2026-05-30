'use client';

import { useCallback, useMemo, useState } from 'react';
import { Archive } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ListSearchInput,
  PageHeader,
  toast,
  type DataTableColumn,
} from '@/components/ui';
import { SnapshotDiffPanel } from './snapshot-diff-panel';

export interface SerializableSnapshot {
  id: string;
  domain: string;
  locale: string;
  version: number;
  contentHash: string;
  refCount: number;
  termCount: number;
  archived: boolean;
  createdAt: string;
}

interface SnapshotsContentProps {
  initialSnapshots: SerializableSnapshot[];
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

/**
 * Snapshots browser: list (F7) + rollback confirm (F8).
 *
 * Selecting a row opens the diff panel which lazily fetches
 * /api/v1/domain-vocabularies/snapshots/[id] for the resolved terms +
 * set-comparison. The rollback button moves through a single
 * confirmation step before calling POST /rollback.
 */
export function SnapshotsContent({ initialSnapshots }: SnapshotsContentProps) {
  const t = useTranslations('domainVocabularies.snapshotsView');
  const tNav = useTranslations('dashboardNav');
  const locale = useLocale();

  const [snapshots, setSnapshots] = useState<SerializableSnapshot[]>(initialSnapshots);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SerializableSnapshot | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<SerializableSnapshot | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snapshots;
    return snapshots.filter(
      (s) =>
        s.domain.toLowerCase().includes(q) ||
        s.locale.toLowerCase().includes(q) ||
        s.contentHash.toLowerCase().includes(q),
    );
  }, [snapshots, query]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/domain-vocabularies/snapshots', {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        snapshots: Array<Omit<SerializableSnapshot, 'createdAt'> & { createdAt: string }>;
      };
      setSnapshots(data.snapshots);
    } catch (err) {
      console.error('[snapshots] refresh failed', err);
      toast.error(t('refreshFailed'));
    }
  }, [t]);

  const handleRollback = useCallback(async () => {
    if (!rollbackTarget) return;
    setRollingBack(true);
    try {
      const res = await fetch(
        `/api/v1/domain-vocabularies/snapshots/${rollbackTarget.id}/rollback`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          credentials: 'same-origin',
        },
      );
      if (!res.ok) {
        const env = (await res.json().catch(() => ({}))) as ErrorEnvelope;
        throw new Error(env.error?.message ?? t('rollbackFailed'));
      }
      const data = (await res.json()) as {
        added: number;
        removed: number;
        unchanged: number;
      };
      toast.success(
        t('rollbackSuccess', {
          added: data.added,
          removed: data.removed,
          unchanged: data.unchanged,
        }),
      );
      setRollbackTarget(null);
      setSelected(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('rollbackFailed'));
    } finally {
      setRollingBack(false);
    }
  }, [rollbackTarget, refresh, t]);

  const columns: DataTableColumn<SerializableSnapshot>[] = [
    {
      key: 'scope',
      header: t('table.scope'),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-fg">
            {row.domain} · {row.locale}
          </span>
          <span className="font-mono text-xs text-fg-subtle">
            {t('table.version', { n: row.version })}
          </span>
        </div>
      ),
    },
    {
      key: 'termCount',
      header: t('table.termCount'),
      className: 'text-right',
      cell: (row) => (
        <span className="font-mono text-sm text-fg">{row.termCount}</span>
      ),
    },
    {
      key: 'refCount',
      header: t('table.refCount'),
      className: 'text-right',
      cell: (row) => (
        <span className="font-mono text-sm text-fg-muted">{row.refCount}</span>
      ),
    },
    {
      key: 'contentHash',
      header: t('table.hash'),
      cell: (row) => (
        <code className="text-xs text-fg-subtle">
          {row.contentHash.slice(0, 12)}…
        </code>
      ),
    },
    {
      key: 'createdAt',
      header: t('table.createdAt'),
      cell: (row) => (
        <span className="text-sm text-fg-muted">
          {dateFormatter.format(new Date(row.createdAt))}
        </span>
      ),
    },
    {
      key: 'archived',
      header: t('table.status'),
      cell: (row) =>
        row.archived ? (
          <Badge variant="warning">
            <Archive className="mr-1 inline h-3 w-3" aria-hidden="true" />
            {t('table.archivedBadge')}
          </Badge>
        ) : (
          <Badge variant="success">{t('table.activeBadge')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: t('table.actions'),
      srHeader: true,
      className: 'text-right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(row)}
          >
            {t('actions.view')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={row.archived}
            title={row.archived ? t('archivedTooltip') : undefined}
            onClick={() => setRollbackTarget(row)}
          >
            {t('actions.rollback')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: tNav('dashboard'), href: '/dashboard' },
          { label: tNav('domainVocabularies'), href: '/domain-vocabularies' },
          { label: t('title') },
        ]}
      />

      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {snapshots.length > 0 ? (
        <div className="mt-6">
          <ListSearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('searchPlaceholder')}
          />
        </div>
      ) : null}

      <div className="mt-4">
        <DataTable
          columns={columns}
          rows={visible}
          getRowKey={(row) => row.id}
          aria-label={t('title')}
          emptyState={
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
            />
          }
        />
      </div>

      {selected ? (
        <SnapshotDiffPanel
          snapshot={selected}
          onClose={() => setSelected(null)}
          onRollback={() => setRollbackTarget(selected)}
        />
      ) : null}

      <ConfirmDialog
        isOpen={rollbackTarget !== null}
        title={t('rollback.title')}
        description={
          rollbackTarget
            ? t('rollback.description', {
                domain: rollbackTarget.domain,
                locale: rollbackTarget.locale,
                version: rollbackTarget.version,
              })
            : ''
        }
        variant="warning"
        confirmLabel={t('rollback.confirm')}
        cancelLabel={t('rollback.cancel')}
        isLoading={rollingBack}
        onConfirm={handleRollback}
        onCancel={() => {
          if (!rollingBack) setRollbackTarget(null);
        }}
      />
    </div>
  );
}

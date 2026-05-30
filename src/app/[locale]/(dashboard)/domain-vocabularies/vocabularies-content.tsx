'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  Badge,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ListSearchInput,
  PageHeader,
  Select,
  StatCard,
  toast,
  type DataTableColumn,
} from '@/components/ui';
import { CLIENT_CAPABILITIES } from '@/hooks/use-deployment-mode';
import { VocabularyDialog, type VocabularyDialogValues } from './vocabulary-dialog';

/**
 * Serializable wire-format of a TermLink: timestamps as ISO strings so the
 * server component can pass the row through React's serialization boundary.
 */
export interface SerializableTermLink {
  id: string;
  termId: string;
  userId: string;
  domain: string;
  locale: string;
  kind: string;
  canonical: string;
  localized: string;
  parentCanonical: string | null;
  aliases: string[];
  description: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface VocabularyQuota {
  maxTerms: number;
  bulkAsync: boolean;
  allowed: boolean;
}

interface VocabulariesContentProps {
  initialTerms: SerializableTermLink[];
  initialTotal: number;
  initialArchivedCount: number;
  quota: VocabularyQuota;
}

const KIND_OPTIONS = ['struct', 'field', 'function', 'enum_value'] as const;

const KNOWN_ERROR_CODES = new Set([
  'quota_exceeded',
  'duplicate_link',
  'validation_failed',
  'not_found',
  'plan_gate_required',
  'internal_error',
]);

interface ListResponse {
  items: SerializableTermLink[];
  total: number;
  page: number;
  pageSize: number;
  archivedCount: number;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

const PAGE_SIZE = 50;

export function VocabulariesContent({
  initialTerms,
  initialTotal,
  initialArchivedCount,
  quota,
}: VocabulariesContentProps) {
  const t = useTranslations('domainVocabularies');
  const tNav = useTranslations('dashboardNav');

  const [terms, setTerms] = useState<SerializableTermLink[]>(initialTerms);
  const [total, setTotal] = useState<number>(initialTotal);
  const [archivedCount, setArchivedCount] = useState<number>(initialArchivedCount);
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [localeFilter, setLocaleFilter] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SerializableTermLink | null>(null);
  const [deleting, setDeleting] = useState<SerializableTermLink | null>(null);
  const [busy, setBusy] = useState(false);

  // Refetch the list whenever a server-side filter changes. Client-side
  // search (`query`) stays local so the UX feels instant.
  useEffect(() => {
    if (!quota.allowed) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainFilter, localeFilter, kindFilter]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const url = new URL('/api/v1/domain-vocabularies/terms', window.location.origin);
      if (domainFilter) url.searchParams.set('domain', domainFilter);
      if (localeFilter) url.searchParams.set('locale', localeFilter);
      if (kindFilter) url.searchParams.set('kind', kindFilter);
      url.searchParams.set('page', '1');
      url.searchParams.set('pageSize', String(PAGE_SIZE));

      const res = await fetch(url.toString(), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setTerms(data.items);
      setTotal(data.total);
      setArchivedCount(data.archivedCount);
    } catch (err) {
      toast.error(t('dialog.errorGeneric'));
      console.error('[vocabularies] refetch failed', err);
    } finally {
      setIsLoading(false);
    }
  }, [domainFilter, localeFilter, kindFilter, t]);

  // Distinct (domain, locale) values from the current page — used to
  // populate the filter dropdowns without an extra API call. As the user
  // narrows the dataset, the option set shrinks accordingly.
  const domainOptions = useMemo(
    () => Array.from(new Set(initialTerms.concat(terms).map((t) => t.domain))).sort(),
    [initialTerms, terms],
  );
  const localeOptions = useMemo(
    () => Array.from(new Set(initialTerms.concat(terms).map((t) => t.locale))).sort(),
    [initialTerms, terms],
  );

  const visibleTerms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return terms;
    return terms.filter(
      (term) =>
        term.canonical.toLowerCase().includes(q) ||
        term.localized.toLowerCase().includes(q) ||
        term.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [terms, query]);

  const errorMessage = useCallback(
    (code: string | undefined, fallback: string | undefined) => {
      if (code && KNOWN_ERROR_CODES.has(code)) {
        return t(`errors.${code}` as 'errors.quota_exceeded');
      }
      return fallback ?? t('dialog.errorGeneric');
    },
    [t],
  );

  const handleSave = useCallback(
    async (values: VocabularyDialogValues) => {
      setBusy(true);
      try {
        const url = editing
          ? `/api/v1/domain-vocabularies/terms/${editing.id}`
          : '/api/v1/domain-vocabularies/terms';
        const method = editing ? 'PATCH' : 'POST';
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          credentials: 'same-origin',
          body: JSON.stringify(values),
        });
        if (!res.ok) {
          const env = (await res.json().catch(() => ({}))) as ErrorEnvelope;
          const code = env.error?.code ?? 'internal_error';
          const message = errorMessage(code, env.error?.message);
          throw new Error(message);
        }
        setDialogOpen(false);
        setEditing(null);
        await refetch();
        toast.success(editing ? t('dialog.editTitle') : t('dialog.createTitle'));
      } catch (err) {
        const message = err instanceof Error ? err.message : t('dialog.errorGeneric');
        toast.error(message);
        // Re-throw so the dialog keeps the form open with the error visible.
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [editing, errorMessage, refetch, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/domain-vocabularies/terms/${deleting.id}`,
        {
          method: 'DELETE',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          credentials: 'same-origin',
        },
      );
      if (!res.ok) {
        const env = (await res.json().catch(() => ({}))) as ErrorEnvelope;
        throw new Error(errorMessage(env.error?.code, env.error?.message));
      }
      setDeleting(null);
      await refetch();
      toast.success(t('actions.delete'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dialog.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }, [deleting, errorMessage, refetch, t]);

  // Pro-gate. We render an inline upgrade card rather than the full
  // page so users can still see the breadcrumb + sidebar context.
  if (!quota.allowed) {
    return (
      <div>
        <Breadcrumbs
          className="mb-4"
          items={[
            { label: tNav('dashboard'), href: '/dashboard' },
            { label: tNav('domainVocabularies') },
          ]}
        />
        <EmptyState
          title={t('needsUpgrade.title')}
          description={t('needsUpgrade.description')}
          action={
            CLIENT_CAPABILITIES.billing ? (
              <Link
                href="/billing"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-sm hover:bg-primary-hover"
              >
                {t('needsUpgrade.upgrade')}
              </Link>
            ) : (
              <span className="inline-flex items-center rounded-md bg-bg-subtle px-4 py-2 text-sm font-medium text-fg-muted">
                {t('needsUpgrade.contactAdmin')}
              </span>
            )
          }
        />
      </div>
    );
  }

  const columns: DataTableColumn<SerializableTermLink>[] = [
    {
      key: 'canonical',
      header: t('table.canonical'),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-mono text-sm font-medium text-fg">{row.canonical}</span>
          {row.parentCanonical ? (
            <span className="font-mono text-xs text-fg-subtle">
              {row.parentCanonical}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'localized',
      header: t('table.localized'),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="text-sm text-fg">{row.localized}</span>
          {row.aliases.length > 0 ? (
            <span className="text-xs text-fg-subtle">{row.aliases.join(', ')}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'domain',
      header: t('table.domain'),
      cell: (row) => <span className="text-sm text-fg-muted">{row.domain}</span>,
    },
    {
      key: 'locale',
      header: t('table.locale'),
      cell: (row) => <span className="text-sm text-fg-muted">{row.locale}</span>,
    },
    {
      key: 'kind',
      header: t('table.kind'),
      cell: (row) => (
        <Badge variant="neutral">{t(`kinds.${row.kind}` as 'kinds.struct')}</Badge>
      ),
    },
    {
      key: 'updatedAt',
      header: t('table.updatedAt'),
      cell: (row) => (
        <span className="text-sm text-fg-muted">
          {new Date(row.updatedAt).toLocaleDateString()}
        </span>
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
            onClick={() => {
              setEditing(row);
              setDialogOpen(true);
            }}
          >
            {t('actions.edit')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleting(row)}
          >
            {t('actions.delete')}
          </Button>
        </div>
      ),
    },
  ];

  const quotaLabel =
    quota.maxTerms === -1
      ? t('quota.unlimited')
      : t('quota.used', { used: total, total: quota.maxTerms });
  const remaining =
    quota.maxTerms === -1 ? null : Math.max(0, quota.maxTerms - total);
  const atLimit = quota.maxTerms !== -1 && total >= quota.maxTerms;
  const quotaTone: 'neutral' | 'warning' | 'danger' =
    atLimit
      ? 'danger'
      : quota.maxTerms !== -1 && total >= quota.maxTerms * 0.9
        ? 'warning'
        : 'neutral';

  return (
    <div>
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: tNav('dashboard'), href: '/dashboard' },
          { label: tNav('domainVocabularies') },
        ]}
      />

      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            disabled={atLimit}
            aria-disabled={atLimit}
            title={atLimit ? t('quota.atLimit') : undefined}
          >
            {t('newTerm')}
          </Button>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t('quota.label')}
          value={quotaLabel}
          tone={quotaTone}
          hint={
            remaining === null
              ? undefined
              : atLimit
                ? t('quota.atLimit')
                : t('quota.remaining', { n: remaining })
          }
        />
        <StatCard label={t('table.kind')} value={String(terms.length)} />
        <StatCard
          label={t('filters.includeArchived')}
          value={String(archivedCount)}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <ListSearchInput
            value={query}
            onChange={setQuery}
            placeholder={t('filters.search')}
          />
        </div>
        <Select
          aria-label={t('filters.domain')}
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
        >
          <option value="">{t('filters.all')}</option>
          {domainOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.locale')}
          value={localeFilter}
          onChange={(e) => setLocaleFilter(e.target.value)}
        >
          <option value="">{t('filters.all')}</option>
          {localeOptions.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('filters.kind')}
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="">{t('filters.all')}</option>
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}` as 'kinds.struct')}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-6">
        <DataTable
          columns={columns}
          rows={visibleTerms}
          getRowKey={(row) => row.id}
          loading={isLoading}
          aria-label={t('title')}
          emptyState={
            <EmptyState
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                  disabled={atLimit}
                >
                  {t('newTerm')}
                </Button>
              }
            />
          }
        />
      </div>

      <VocabularyDialog
        isOpen={dialogOpen}
        mode={editing ? 'edit' : 'create'}
        initialValues={editing ?? undefined}
        onClose={() => {
          if (!busy) {
            setDialogOpen(false);
            setEditing(null);
          }
        }}
        onSave={handleSave}
        isSaving={busy}
      />

      <ConfirmDialog
        isOpen={!!deleting}
        title={t('delete.title')}
        description={
          deleting
            ? t('delete.description', { name: deleting.localized })
            : ''
        }
        variant="danger"
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.cancel')}
        isLoading={busy}
        onConfirm={handleDelete}
        onCancel={() => {
          if (!busy) setDeleting(null);
        }}
      />
    </div>
  );
}

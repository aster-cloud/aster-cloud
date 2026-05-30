'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
import { BulkJobProgress } from './bulk-job-progress';
import { BulkUploadDialog } from './bulk-upload-dialog';
import { KIND_OPTIONS, KNOWN_ERROR_CODES, type Kind } from './constants';
import { DowngradeBanner, ProGate } from './pro-gate';
import { VocabularyDialog, type VocabularyDialogValues } from './vocabulary-dialog';

const STARTER_PLAN = 'starter';

type KindKey = `kinds.${Kind}`;
type ErrorKey = `errors.${
  | 'quota_exceeded'
  | 'duplicate_link'
  | 'validation_failed'
  | 'not_found'
  | 'plan_gate_required'
  | 'internal_error'}`;

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
  /** Current plan after trial-expiry resolution. */
  plan: string;
  /** True when this request crossed the trial→free boundary. */
  downgraded: boolean;
  /** ISO timestamp when the trial ends/ended; null when never on trial. */
  trialEndsAt: string | null;
}

interface VocabulariesContentProps {
  initialTerms: SerializableTermLink[];
  initialTotal: number;
  initialArchivedCount: number;
  quota: VocabularyQuota;
}

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
const QUOTA_WARNING_THRESHOLD = 0.9;

function pickQuotaTone(
  isUnlimited: boolean,
  used: number,
  max: number,
  atLimit: boolean,
): 'neutral' | 'warning' | 'danger' {
  if (atLimit) return 'danger';
  if (!isUnlimited && used >= max * QUOTA_WARNING_THRESHOLD) return 'warning';
  return 'neutral';
}

function isKnownKind(value: string): value is Kind {
  return (KIND_OPTIONS as readonly string[]).includes(value);
}

export function VocabulariesContent({
  initialTerms,
  initialTotal,
  initialArchivedCount,
  quota,
}: VocabulariesContentProps) {
  const t = useTranslations('domainVocabularies');
  const tNav = useTranslations('dashboardNav');
  const locale = useLocale();

  const [terms, setTerms] = useState<SerializableTermLink[]>(initialTerms);
  const [total, setTotal] = useState<number>(initialTotal);
  const [archivedCount, setArchivedCount] = useState<number>(initialArchivedCount);
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [localeFilter, setLocaleFilter] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  // Filter options grow as the user sees more data but never shrink: a
  // narrowing refetch would otherwise hide the dropdown values that
  // allow the user to widen the filter back out. Seeded from the SSR
  // payload so the dropdowns are useful before the first interaction.
  const facetsRef = useRef<{ domains: Set<string>; locales: Set<string> }>({
    domains: new Set(initialTerms.map((t) => t.domain)),
    locales: new Set(initialTerms.map((t) => t.locale)),
  });
  // facetsTick is the only React-visible signal that the facet sets grew.
  // The memoized sorted snapshots below key off it so we don't have to lie
  // about the dependency list (Set.size would technically work today, but
  // it's load-bearing on render ordering — keying on the tick is honest).
  const [facetsTick, setFacetsTick] = useState(0);
  const noteFacets = useCallback((rows: SerializableTermLink[]) => {
    let changed = false;
    for (const row of rows) {
      if (!facetsRef.current.domains.has(row.domain)) {
        facetsRef.current.domains.add(row.domain);
        changed = true;
      }
      if (!facetsRef.current.locales.has(row.locale)) {
        facetsRef.current.locales.add(row.locale);
        changed = true;
      }
    }
    if (changed) setFacetsTick((n) => n + 1);
  }, []);

  // Aborts any inflight refetch so rapid filter changes don't race.
  const inflightRef = useRef<AbortController | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SerializableTermLink | null>(null);
  const [deleting, setDeleting] = useState<SerializableTermLink | null>(null);
  const [busy, setBusy] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Refetch the list whenever a server-side filter changes. Client-side
  // search (`query`) stays local so the UX feels instant.
  useEffect(() => {
    if (!quota.allowed) return;
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainFilter, localeFilter, kindFilter]);

  const refetch = useCallback(async () => {
    inflightRef.current?.abort();
    const controller = new AbortController();
    inflightRef.current = controller;
    setIsLoading(true);
    try {
      const url = new URL('/api/v1/domain-vocabularies/terms', window.location.origin);
      if (domainFilter) url.searchParams.set('domain', domainFilter);
      if (localeFilter) url.searchParams.set('locale', localeFilter);
      if (kindFilter) url.searchParams.set('kind', kindFilter);
      url.searchParams.set('page', '1');
      url.searchParams.set('pageSize', String(PAGE_SIZE));

      const res = await fetch(url.toString(), {
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setTerms(data.items);
      setTotal(data.total);
      setArchivedCount(data.archivedCount);
      noteFacets(data.items);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error(t('dialog.errorGeneric'));
      console.error('[vocabularies] refetch failed', err);
    } finally {
      if (inflightRef.current === controller) {
        setIsLoading(false);
        inflightRef.current = null;
      }
    }
  }, [domainFilter, localeFilter, kindFilter, noteFacets, t]);

  // Sorted snapshot of the facet sets for the dropdowns. The Sets are
  // stored in a ref so noteFacets can mutate them without triggering a
  // render; facetsTick is the React-visible "the sets grew" signal that
  // forces this memo to re-evaluate. The dep on facetsTick looks
  // unnecessary to eslint because facetsRef.current isn't reactive — it
  // is in fact load-bearing, so the disable is intentional.
  const domainOptions = useMemo(
    () => [...facetsRef.current.domains].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facetsTick],
  );
  const localeOptions = useMemo(
    () => [...facetsRef.current.locales].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facetsTick],
  );

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  const translateKind = useCallback(
    (kind: string) => {
      if (isKnownKind(kind)) return t(`kinds.${kind}` as KindKey);
      return kind;
    },
    [t],
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
        return t(`errors.${code}` as ErrorKey);
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

  // Pro-gate. Full lock-screen carries the upgrade CTA + a downgrade
  // narrative when applicable so the user can tell why the page is
  // suddenly gated. Trial→free is the common case worth narrating.
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
        <ProGate
          trialExpired={quota.downgraded}
          trialEndsAt={quota.trialEndsAt}
        />
      </div>
    );
  }

  const isStarterPlan = quota.plan === STARTER_PLAN;

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
        <Badge variant="neutral">{translateKind(row.kind)}</Badge>
      ),
    },
    {
      key: 'updatedAt',
      header: t('table.updatedAt'),
      cell: (row) => (
        <span className="text-sm text-fg-muted">
          {dateFormatter.format(new Date(row.updatedAt))}
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

  const isUnlimited = quota.maxTerms === -1;
  const quotaLabel = isUnlimited
    ? t('quota.unlimited')
    : t('quota.used', { used: total, total: quota.maxTerms });
  const remaining = isUnlimited ? null : Math.max(0, quota.maxTerms - total);
  const atLimit = !isUnlimited && total >= quota.maxTerms;
  const quotaTone = pickQuotaTone(isUnlimited, total, quota.maxTerms, atLimit);

  return (
    <div>
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: tNav('dashboard'), href: '/dashboard' },
          { label: tNav('domainVocabularies') },
        ]}
      />

      <DowngradeBanner
        starterPlan={isStarterPlan}
        trialExpired={quota.downgraded}
        trialEndsAt={quota.trialEndsAt}
      />

      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/domain-vocabularies/snapshots"
              className="inline-flex items-center rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
            >
              {t('snapshots')}
            </Link>
            <Button
              variant="outline"
              onClick={() => setBulkOpen(true)}
              disabled={atLimit}
              title={atLimit ? t('quota.atLimit') : undefined}
            >
              {t('bulkUpload')}
            </Button>
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
          </div>
        }
      />

      {activeJobId ? (
        <div className="mt-4">
          <BulkJobProgress
            jobId={activeJobId}
            onClear={() => setActiveJobId(null)}
            onTerminal={() => {
              void refetch();
            }}
          />
        </div>
      ) : null}

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
        <StatCard label={t('stats.visible')} value={String(terms.length)} />
        <StatCard label={t('stats.archived')} value={String(archivedCount)} />
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
              {translateKind(k)}
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

      <BulkUploadDialog
        isOpen={bulkOpen}
        bulkAsyncAllowed={quota.bulkAsync}
        onClose={() => setBulkOpen(false)}
        onEnqueued={(jobId) => setActiveJobId(jobId)}
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

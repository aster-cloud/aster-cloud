'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileText, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  AlertDescription,
  Button,
  Label,
  Textarea,
  toast,
} from '@/components/ui';
import { KIND_OPTIONS, type Kind } from './constants';

interface BulkUploadDialogProps {
  isOpen: boolean;
  /** True when the caller's plan supports async (Pro+); else only sync. */
  bulkAsyncAllowed: boolean;
  onClose: () => void;
  onEnqueued: (jobId: string) => void;
}

/** Pre-validated row shape. Matches the /bulk{,/jobs} endpoint contract. */
interface ParsedRow {
  domain: string;
  locale: string;
  kind: Kind;
  canonical: string;
  localized: string;
  parentCanonical?: string;
  description?: string;
  aliases?: string[];
}

interface ParseFinding {
  row: number;
  message: string;
}

interface ParseOutcome {
  rows: ParsedRow[];
  errors: ParseFinding[];
}

const SYNC_LIMIT = 500;
const ASYNC_LIMIT = 10_000;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Multi-row upload dialog.
 *
 * The user pastes either CSV (header row required) or a JSON array of term
 * objects. Both encodings parse to the same {@link ParsedRow} shape. We
 * preview the first {@link PREVIEW_ROWS} rows, surface validation errors
 * inline, and let the user pick sync (≤500) or async (≤10k) submission
 * before sending the payload.
 */
export function BulkUploadDialog({
  isOpen,
  bulkAsyncAllowed,
  onClose,
  onEnqueued,
}: BulkUploadDialogProps) {
  const t = useTranslations('domainVocabularies.bulk');
  const titleId = useId();
  const formRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<'sync' | 'async'>('sync');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setRaw('');
    setMode('sync');
    setSubmitError('');
    setSubmitting(false);
  }, [isOpen]);

  // ESC + Tab trap. Mirrors VocabularyDialog so a11y stays consistent.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !formRef.current) return;
      const focusable = formRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, submitting, onClose]);

  const outcome = useMemo<ParseOutcome>(() => parseInput(raw), [raw]);
  const preview = outcome.rows.slice(0, 20);
  const totalRows = outcome.rows.length;
  const overSync = totalRows > SYNC_LIMIT;
  const overAsync = totalRows > ASYNC_LIMIT;
  const canSubmit =
    !submitting &&
    totalRows > 0 &&
    outcome.errors.length === 0 &&
    !overAsync &&
    (mode === 'async' || !overSync);

  // If the chosen mode doesn't fit, auto-pick the larger one when allowed.
  useEffect(() => {
    if (overSync && bulkAsyncAllowed && mode === 'sync') {
      setMode('async');
    }
  }, [overSync, bulkAsyncAllowed, mode]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const url =
        mode === 'sync'
          ? '/api/v1/domain-vocabularies/bulk'
          : '/api/v1/domain-vocabularies/bulk/jobs';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        credentials: 'same-origin',
        body: JSON.stringify({ terms: outcome.rows }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; code?: string };
        };
        throw new Error(
          body.error?.message ?? t('errorGeneric'),
        );
      }
      const data = (await res.json()) as { jobId?: string };
      if (mode === 'async') {
        toast.success(t('asyncEnqueued'));
        if (data.jobId) onEnqueued(data.jobId);
      } else {
        toast.success(t('syncCompleted', { count: totalRows }));
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errorGeneric');
      setSubmitError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      setRaw(text);
    } catch {
      setSubmitError(t('errorReadFile'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />

      <div
        ref={formRef}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-bg shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id={titleId} className="font-display text-lg font-semibold text-fg">
            {t('title')}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!submitting) onClose();
            }}
            aria-label={t('cancel')}
            className="rounded p-1 text-fg-muted hover:bg-bg-subtle hover:text-fg focus:outline-none focus-visible:shadow-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="overflow-y-auto px-6 py-4">
          <p className="text-sm text-fg-muted">{t('description')}</p>

          <div className="mt-4 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('chooseFile')}
            </Button>
            <span className="text-xs text-fg-subtle">{t('orPaste')}</span>
          </div>

          <div className="mt-3">
            <Label htmlFor="bulk-raw">{t('rawLabel')}</Label>
            <Textarea
              id="bulk-raw"
              rows={6}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t('placeholder')}
              className="font-mono text-xs"
            />
          </div>

          {totalRows > 0 ? (
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">
                  {t('previewTitle', { shown: preview.length, total: totalRows })}
                </h3>
                <span className="text-xs text-fg-subtle">
                  {t(overAsync ? 'tooManyAsync' : overSync ? 'tooManySync' : 'rowsValid', {
                    syncLimit: SYNC_LIMIT,
                    asyncLimit: ASYNC_LIMIT,
                  })}
                </span>
              </div>
              <div className="mt-2 overflow-x-auto rounded-md border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-bg-subtle text-xs uppercase text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">{t('col.kind')}</th>
                      <th className="px-3 py-2 text-left">{t('col.canonical')}</th>
                      <th className="px-3 py-2 text-left">{t('col.localized')}</th>
                      <th className="px-3 py-2 text-left">{t('col.domain')}</th>
                      <th className="px-3 py-2 text-left">{t('col.locale')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{row.kind}</td>
                        <td className="px-3 py-2 font-mono text-xs">{row.canonical}</td>
                        <td className="px-3 py-2">{row.localized}</td>
                        <td className="px-3 py-2 text-fg-muted">{row.domain}</td>
                        <td className="px-3 py-2 text-fg-muted">{row.locale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {outcome.errors.length > 0 ? (
            <div className="mt-4">
              <Alert variant="danger">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>
                  <p className="font-medium">{t('parseErrorsTitle')}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                    {outcome.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>
                        #{err.row}: {err.message}
                      </li>
                    ))}
                    {outcome.errors.length > 5 ? (
                      <li>{t('moreErrors', { n: outcome.errors.length - 5 })}</li>
                    ) : null}
                  </ul>
                </AlertDescription>
              </Alert>
            </div>
          ) : null}

          {totalRows > 0 ? (
            <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
              <legend className="text-xs font-medium text-fg-muted">
                {t('modeLabel')}
              </legend>
              <ModeOption
                id="bulk-mode-sync"
                checked={mode === 'sync'}
                onChange={() => setMode('sync')}
                disabled={overSync}
                title={t('syncTitle')}
                description={t('syncDescription', { limit: SYNC_LIMIT })}
              />
              <ModeOption
                id="bulk-mode-async"
                checked={mode === 'async'}
                onChange={() => setMode('async')}
                disabled={!bulkAsyncAllowed || overAsync}
                title={t('asyncTitle')}
                description={
                  bulkAsyncAllowed
                    ? t('asyncDescription', { limit: ASYNC_LIMIT })
                    : t('asyncProRequired')
                }
              />
            </fieldset>
          ) : null}

          {submitError ? (
            <div className="mt-4">
              <Alert variant="danger">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (!submitting) onClose();
            }}
            disabled={submitting}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? t('submitting') : t('submit')}
          </Button>
        </footer>
      </div>
    </div>
  );
}

interface ModeOptionProps {
  id: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title: string;
  description: string;
}

function ModeOption({
  id,
  checked,
  onChange,
  disabled,
  title,
  description,
}: ModeOptionProps) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm ${
        disabled
          ? 'cursor-not-allowed border-border bg-bg-subtle text-fg-subtle'
          : checked
            ? 'border-primary bg-primary-subtle text-fg'
            : 'border-border bg-bg text-fg hover:bg-bg-subtle'
      }`}
    >
      <input
        id={id}
        type="radio"
        className="mt-1 h-4 w-4"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="flex flex-col">
        <span className="flex items-center gap-1 font-medium">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {title}
        </span>
        <span className="text-xs text-fg-muted">{description}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseInput(raw: string): ParseOutcome {
  const trimmed = raw.trim();
  if (!trimmed) return { rows: [], errors: [] };
  // JSON path: leading '[' or '{'.
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJson(trimmed);
  }
  return parseCsv(trimmed);
}

function parseJson(text: string): ParseOutcome {
  const errors: ParseFinding[] = [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { rows: [], errors: [{ row: 0, message: 'Invalid JSON syntax' }] };
  }
  const array = Array.isArray(value) ? value : [value];
  const rows: ParsedRow[] = [];
  array.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ row: index + 1, message: 'Row is not an object' });
      return;
    }
    const parsed = coerceRow(entry as Record<string, unknown>);
    if ('error' in parsed) {
      errors.push({ row: index + 1, message: parsed.error });
    } else {
      rows.push(parsed.row);
    }
  });
  return { rows, errors };
}

function parseCsv(text: string): ParseOutcome {
  const errors: ParseFinding[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return {
      rows: [],
      errors: [{ row: 0, message: 'CSV needs a header row and at least one row' }],
    };
  }
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length !== header.length) {
      errors.push({
        row: i + 1,
        message: `expected ${header.length} columns, got ${cells.length}`,
      });
      continue;
    }
    const record: Record<string, unknown> = {};
    header.forEach((key, idx) => {
      record[key] = cells[idx];
    });
    // CSV aliases column accepts pipe-delimited values to avoid escaping commas.
    if (typeof record.aliases === 'string' && record.aliases) {
      record.aliases = (record.aliases as string)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const parsed = coerceRow(record);
    if ('error' in parsed) {
      errors.push({ row: i + 1, message: parsed.error });
    } else {
      rows.push(parsed.row);
    }
  }
  return { rows, errors };
}

/** Minimal CSV splitter — supports quoted strings + escaped quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else {
      if (c === ',') {
        out.push(current);
        current = '';
      } else if (c === '"') {
        inQuotes = true;
      } else {
        current += c;
      }
    }
  }
  out.push(current);
  return out;
}

type CoerceResult = { row: ParsedRow } | { error: string };

function coerceRow(record: Record<string, unknown>): CoerceResult {
  const required = (key: string): string | undefined => {
    const v = record[key];
    if (typeof v !== 'string' || v.trim() === '') return undefined;
    return v.trim();
  };
  const optionalString = (key: string): string | undefined => {
    const v = record[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const kindRaw = required('kind');
  if (!kindRaw) return { error: 'kind is required' };
  if (!(KIND_OPTIONS as readonly string[]).includes(kindRaw)) {
    return { error: `kind must be one of ${KIND_OPTIONS.join(', ')}` };
  }
  const domain = required('domain');
  const locale = required('locale');
  const canonical = required('canonical');
  const localized = required('localized');
  if (!domain) return { error: 'domain is required' };
  if (!locale) return { error: 'locale is required' };
  if (!canonical) return { error: 'canonical is required' };
  if (!localized) return { error: 'localized is required' };

  const kind = kindRaw as Kind;
  const parentCanonical = optionalString('parentCanonical');
  if (kind === 'field' && !parentCanonical) {
    return { error: 'parentCanonical is required for kind=field' };
  }

  const aliases = Array.isArray(record.aliases)
    ? (record.aliases.filter((v) => typeof v === 'string' && v.length > 0) as string[])
    : undefined;

  const row: ParsedRow = {
    domain,
    locale,
    kind,
    canonical,
    localized,
  };
  if (parentCanonical) row.parentCanonical = parentCanonical;
  const description = optionalString('description');
  if (description) row.description = description;
  if (aliases && aliases.length > 0) row.aliases = aliases;
  return { row };
}

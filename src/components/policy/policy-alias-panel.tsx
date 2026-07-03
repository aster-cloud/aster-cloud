'use client';

import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, Input, Label, cn } from '@/components/ui';
import { getLexicon } from '@/lib/aster-lexicon';
import {
  normalizeAliasToken,
  validateUserAliases,
  type ReservedSets,
} from '@/lib/policy-alias-shared';
import {
  ALIAS_KIND_GROUPS,
  ALL_ALIAS_KINDS,
  kindToSemanticToken,
  type AliasKindGroup,
  type AliasKindMeta,
} from './policy-alias-types';

export interface PolicyAliasPanelProps {
  aliasSet: Record<string, string[]>;
  locale: string;
  reservedSets: ReservedSets;
  allowStructural: boolean;
  onChange: (aliasSet: Record<string, string[]>) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

function parseAliases(value: string): string[] {
  return value
    .split(',')
    .map((part) => normalizeAliasToken(part))
    .filter(Boolean);
}

function configuredCount(aliasSet: Record<string, string[]>): number {
  return Object.values(aliasSet).reduce(
    (sum, values) => sum + values.filter((v) => v.trim()).length,
    0,
  );
}

function kindsForGroup(group: AliasKindGroup): AliasKindMeta[] {
  return ALL_ALIAS_KINDS.filter((meta) => meta.group === group);
}

export function PolicyAliasPanel({
  aliasSet,
  locale,
  reservedSets,
  allowStructural,
  onChange,
  expanded,
  onExpandedChange,
}: PolicyAliasPanelProps) {
  const t = useTranslations('policies.form.aliases');
  const panelId = 'policy-alias-panel-body';
  const lexicon = useMemo(() => getLexicon(locale), [locale]);
  const count = configuredCount(aliasSet);

  const updateKind = (kind: string, raw: string) => {
    const values = parseAliases(raw);
    const next = { ...aliasSet };
    if (values.length > 0) {
      next[kind] = values;
    } else {
      delete next[kind];
    }
    onChange(next);
  };

  return (
    <section className="rounded-xl border border-border bg-bg shadow-sm">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          'flex w-full items-center gap-2 px-5 py-3 text-left',
          'transition-colors hover:bg-bg-subtle',
          'focus-visible:outline-none focus-visible:shadow-ring',
          expanded && 'border-b border-border',
        )}
      >
        {expanded ? (
          <ChevronDown aria-hidden className="size-4 text-fg-muted" />
        ) : (
          <ChevronRight aria-hidden className="size-4 text-fg-muted" />
        )}
        <span className="font-medium text-fg">{t('title')}</span>
        <span className="text-xs text-fg-muted">·</span>
        <span className="text-xs text-fg-muted">
          {count > 0 ? t('configuredCount', { count }) : t('hint')}
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="space-y-5 px-5 py-5">
          <p className="text-sm text-fg-muted">{t('hint')}</p>
          {ALIAS_KIND_GROUPS.map((group) => {
            const structural = group.group === 'structural';
            const locked = structural && !allowStructural;
            return (
              <div key={group.group} className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-fg">
                    {t(group.labelKey)}
                  </h3>
                  {locked && (
                    <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                      <Lock aria-hidden className="size-3" />
                      {t('structuralLocked')}
                    </span>
                  )}
                </div>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {kindsForGroup(group.group).map((meta) => (
                    <AliasKindRow
                      key={meta.kind}
                      meta={meta}
                      value={(aliasSet[meta.kind] ?? []).join(', ')}
                      canonical={String(
                        lexicon.keywords[kindToSemanticToken(meta.kind)] ?? meta.kind,
                      )}
                      locked={locked}
                      reservedSets={reservedSets}
                      allowStructural={allowStructural}
                      onChange={updateKind}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AliasKindRow({
  meta,
  value,
  canonical,
  locked,
  reservedSets,
  allowStructural,
  onChange,
}: {
  meta: AliasKindMeta;
  value: string;
  canonical: string;
  locked: boolean;
  reservedSets: ReservedSets;
  allowStructural: boolean;
  onChange: (kind: string, raw: string) => void;
}) {
  const t = useTranslations('policies.form.aliases');
  const inputId = `policy-alias-${meta.kind}`;
  const values = parseAliases(value);
  const result = validateUserAliases(
    values.length > 0 ? { [meta.kind]: values } : {},
    reservedSets,
    { allowStructural },
  );
  const errorId = `${inputId}-error`;

  return (
    <div className={cn('grid gap-3 p-3 md:grid-cols-[8rem_1fr_1.4fr]', locked && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 min-w-9 items-center justify-center rounded-md border border-border bg-bg-subtle px-2 font-mono text-xs text-fg">
          {meta.symbol}
        </span>
        <span className="text-sm font-medium text-fg">{t(`kinds.${meta.labelKey}`)}</span>
      </div>
      <div className="min-w-0">
        <span className="block text-xs text-fg-muted">{t('canonical')}</span>
        <span className="block truncate font-mono text-sm text-fg" title={canonical}>
          {canonical}
        </span>
      </div>
      <div className="min-w-0">
        <Label htmlFor={inputId} className="sr-only">
          {t('inputLabel', { kind: t(`kinds.${meta.labelKey}`) })}
        </Label>
        <Input
          id={inputId}
          value={value}
          disabled={locked}
          onChange={(event) => onChange(meta.kind, event.target.value)}
          placeholder={t('placeholder')}
          aria-invalid={!result.valid || undefined}
          aria-describedby={!result.valid ? errorId : undefined}
        />
        {!result.valid && (
          <Alert id={errorId} role="alert" variant="danger" className="mt-2 py-2">
            <AlertDescription className="text-xs">
              {result.errors.join('; ')}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

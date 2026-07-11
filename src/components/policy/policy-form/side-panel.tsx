'use client';

import { useEffect, useState } from 'react';
import type { editor } from 'monaco-editor';
import { useTranslations } from 'next-intl';
import {
  Sparkles,
  BookOpen,
  LayoutTemplate,
  Activity,
  AlertCircle,
  Settings,
  Tags,
  X,
} from 'lucide-react';
import { AIAssistantPanel } from '@/components/policy/ai-assistant-panel';
import { CNLSyntaxReferencePanel } from '@/components/policy/cnl-syntax-reference-panel';
import { PolicyAliasPanel } from '@/components/policy/policy-alias-panel';
import type { ReservedSets } from '@/lib/policy-alias-shared';
import type {
  CompileDiagnostic,
  CompileModuleSummary,
  CompileState,
} from './use-compile';
import { MetaSection } from './meta-section';
import {
  POLICY_EXAMPLES,
  CATEGORY_LABELS,
  type PolicyExample,
  getExampleName,
  getExampleDescription,
  normalizeLocale,
  type SupportedLocale,
} from '@/data/policy-examples';
import { cn } from '@/components/ui';

/**
 * Side panel — tabbed container for AI, syntax reference, and
 * templates. Replaces the three independent collapsibles the old
 * form scattered across the page (each pushing the editor down).
 *
 * The panel itself is a column inside the IDE layout; the parent
 * decides whether to render it (collapsing it via ⌘B is owned by
 * PolicyForm). When mounted, tabs share the height — only one tab
 * is visible at a time.
 *
 * Tab choices:
 *   - AI: generate / repair using the existing AIAssistantPanel.
 *   - Syntax: CNL quick reference, scoped to the active CNL locale.
 *   - Templates: example-driven starter content. PR-1 replaces the
 *     full body but does NOT yet insert at cursor — that's PR-3
 *     and requires the editor's monaco selection API. For now this
 *     behaves like the old dropdown but in a more findable place
 *     with descriptions visible.
 */

export type SidePanelTab =
  | 'settings'
  | 'aliases'
  | 'problems'
  | 'ai'
  | 'syntax'
  | 'templates';

export interface SidePanelProps {
  editor: editor.IStandaloneCodeEditor | null;
  cnlLocale: SupportedLocale;
  uiLocale: string;
  name: string;
  description: string;
  groupId: string | null;
  isPublic: boolean;
  nameError?: string | null;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onGroupIdChange: (value: string | null) => void;
  onIsPublicChange: (value: boolean) => void;
  aliasSet: Record<string, string[]>;
  reservedSets: ReservedSets;
  allowStructuralAliases: boolean;
  onAliasSetChange: (aliasSet: Record<string, string[]>) => void;
  /** Apply a generated/template body to the form's main content. */
  onApplyContent: (content: string) => void;
  /** Apply a template — sets name + description + content together. */
  onApplyTemplate: (template: PolicyExample) => void;
  /** Close the entire side panel (parent collapses it). */
  onClose: () => void;
  /** Compile state from PolicyForm — drives the Decision tab. */
  compileState?: CompileState;
  compileDiagnostics?: CompileDiagnostic[];
  compileModule?: CompileModuleSummary;
  /** Click a diagnostic row → jump to the offending line in Monaco. */
  onJumpToLine?: (line: number, column: number) => void;
  /** Externally request a specific tab (e.g. compile errored → focus
   *  Decision). Optional — if absent, the panel manages its own tab. */
  initialTab?: SidePanelTab;
}

export function SidePanel({
  editor,
  cnlLocale,
  uiLocale,
  name,
  description,
  groupId,
  isPublic,
  nameError,
  onNameChange,
  onDescriptionChange,
  onGroupIdChange,
  onIsPublicChange,
  aliasSet,
  reservedSets,
  allowStructuralAliases,
  onAliasSetChange,
  onApplyContent,
  onApplyTemplate,
  onClose,
  compileState,
  compileDiagnostics,
  compileModule,
  onJumpToLine,
  initialTab,
}: SidePanelProps) {
  const t = useTranslations('policies.form');
  const [tab, setTab] = useState<SidePanelTab>(initialTab ?? 'ai');
  // Whenever the parent bumps the requested tab (e.g. compile errored),
  // honor it without losing user-selected state otherwise.
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const errorCount =
    compileDiagnostics?.filter((d) => d.severity === 'error').length ?? 0;

  return (
    <aside
      className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-bg shadow-sm"
      aria-label={t('sidePanelToggle')}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1" role="tablist">
          <TabButton
            active={tab === 'settings'}
            onClick={() => setTab('settings')}
            icon={<Settings aria-hidden className="size-4" />}
            label={t('metaSection')}
          />
          <TabButton
            active={tab === 'aliases'}
            onClick={() => setTab('aliases')}
            icon={<Tags aria-hidden className="size-4" />}
            label={t('aliases.title')}
          />
          <TabButton
            active={tab === 'problems'}
            onClick={() => setTab('problems')}
            icon={
              errorCount > 0 ? (
                <AlertCircle aria-hidden className="size-4 text-danger" />
              ) : (
                <Activity aria-hidden className="size-4" />
              )
            }
            label={t('decisionPreview')}
            badge={errorCount > 0 ? errorCount : undefined}
          />
          <TabButton
            active={tab === 'ai'}
            onClick={() => setTab('ai')}
            icon={<Sparkles aria-hidden className="size-4" />}
            label={t('sidePanelAI')}
          />
          <TabButton
            active={tab === 'syntax'}
            onClick={() => setTab('syntax')}
            icon={<BookOpen aria-hidden className="size-4" />}
            label={t('sidePanelSyntax')}
          />
          <TabButton
            active={tab === 'templates'}
            onClick={() => setTab('templates')}
            icon={<LayoutTemplate aria-hidden className="size-4" />}
            label={t('sidePanelTemplates')}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('sidePanelToggle')}
          className="rounded p-1 text-fg-muted hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:shadow-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'settings' && (
          <div className="p-3">
            <MetaSection
              name={name}
              description={description}
              groupId={groupId}
              isPublic={isPublic}
              locale={uiLocale}
              expanded
              // 抽屉 tab 本身就是容器，这里固定展开，避免在抽屉内再折叠。
              onExpandedChange={() => { /* fixed open in the IDE drawer */ }}
              onNameChange={onNameChange}
              onDescriptionChange={onDescriptionChange}
              onGroupIdChange={onGroupIdChange}
              onIsPublicChange={onIsPublicChange}
              nameError={nameError}
            />
          </div>
        )}
        {tab === 'aliases' && (
          <div className="p-3">
            <PolicyAliasPanel
              aliasSet={aliasSet}
              locale={cnlLocale}
              reservedSets={reservedSets}
              allowStructural={allowStructuralAliases}
              onChange={onAliasSetChange}
              expanded
              // 抽屉 tab 本身就是容器，这里固定展开，避免在抽屉内再折叠。
              onExpandedChange={() => { /* fixed open in the IDE drawer */ }}
            />
          </div>
        )}
        {tab === 'ai' && (
          <div className="p-3">
            <AIAssistantPanel
              editor={editor}
              locale={cnlLocale}
              onApply={onApplyContent}
              // Inside the side panel we don't want the inner X to
              // also close the entire side panel — give it a no-op
              // so it can hide its own dismiss affordance behavior
              // without affecting the parent.
              onClose={() => { /* parent owns close via header X */ }}
            />
          </div>
        )}
        {tab === 'syntax' && (
          <div className="p-3">
            <CNLSyntaxReferencePanel
              locale={cnlLocale}
              uiLocale={uiLocale}
              defaultExpanded
              compact
            />
          </div>
        )}
        {tab === 'templates' && (
          <TemplatesTab
            uiLocale={uiLocale}
            cnlLocale={cnlLocale}
            // Picking a template fully delegates to the parent's
            // template handler — which in PR-3 inserts at cursor
            // rather than wiping the form body. We deliberately
            // don't call onApplyContent here anymore.
            onSelect={onApplyTemplate}
          />
        )}
        {tab === 'problems' && (
          <DecisionTab
            state={compileState}
            diagnostics={compileDiagnostics ?? []}
            module={compileModule}
            onJumpToLine={onJumpToLine}
          />
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 py-1 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:shadow-ring',
        active
          ? 'bg-primary-subtle text-primary-hover'
          : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
      )}
    >
      {icon}
      <span className="sr-only">{label}</span>
      {badge !== undefined && (
        <span className="ml-1 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold text-danger-fg leading-none">
          {badge}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Decision tab                                                        */
/* ------------------------------------------------------------------ */

function DecisionTab({
  state,
  diagnostics,
  module: moduleInfo,
  onJumpToLine,
}: {
  state?: CompileState;
  diagnostics: CompileDiagnostic[];
  module?: CompileModuleSummary;
  onJumpToLine?: (line: number, column: number) => void;
}) {
  const t = useTranslations('policies.form');
  // Empty editor / first mount: helpful nudge, not an error.
  if (!state || state === 'idle') {
    return (
      <div className="p-4 text-sm text-fg-muted">{t('decisionNone')}</div>
    );
  }
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  return (
    <div className="space-y-4 p-3">
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-1.5">
          {[...errors, ...warnings].map((d, i) => (
            <li key={`${d.startLine}-${d.startColumn}-${i}`}>
              <button
                type="button"
                onClick={() => onJumpToLine?.(d.startLine, d.startColumn)}
                className={cn(
                  'block w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors',
                  'focus-visible:outline-none focus-visible:shadow-ring',
                  d.severity === 'error'
                    ? 'border-danger/30 bg-danger/5 text-danger hover:bg-danger/10'
                    : 'border-warning/30 bg-warning/5 text-warning-fg hover:bg-warning/10',
                )}
              >
                <div className="font-mono text-[11px] opacity-70">
                  L{d.startLine}:{d.startColumn}
                  {d.code ? ` · ${d.code}` : ''}
                </div>
                <div className="mt-0.5">{d.message}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {moduleInfo && errors.length === 0 && (
        <div className="space-y-2 rounded-md border border-border bg-bg-subtle p-3 text-xs">
          <div>
            <span className="font-semibold text-fg">{t('decisionModule')}: </span>
            <span className="font-mono text-fg-muted">{moduleInfo.name}</span>
          </div>
          {moduleInfo.functions.length > 0 && (
            <div>
              <span className="font-semibold text-fg">
                {t('decisionFunctions')}:{' '}
              </span>
              <span className="font-mono text-fg-muted">
                {moduleInfo.functions.join(', ')}
              </span>
            </div>
          )}
          {moduleInfo.types.length > 0 && (
            <div>
              <span className="font-semibold text-fg">{t('decisionTypes')}: </span>
              <span className="font-mono text-fg-muted">
                {moduleInfo.types.join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Templates tab                                                       */
/* ------------------------------------------------------------------ */

function TemplatesTab({
  uiLocale,
  onSelect,
}: {
  uiLocale: string;
  cnlLocale: SupportedLocale;
  onSelect: (t: PolicyExample) => void;
}) {
  const categories = Object.keys(CATEGORY_LABELS) as Array<
    keyof typeof CATEGORY_LABELS
  >;
  const isZh = uiLocale.startsWith('zh');

  return (
    <div className="space-y-4 p-3">
      <p className="text-xs text-fg-muted">
        {isZh
          ? '点击模板会插入到编辑器光标位置。'
          : 'Picking a template inserts it at the editor cursor.'}
      </p>
      {categories.map((category) => {
        const items = POLICY_EXAMPLES.filter((e) => e.category === category);
        if (items.length === 0) return null;
        return (
          <div key={category}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              {CATEGORY_LABELS[category][normalizeLocale(uiLocale)]}
            </h3>
            <ul className="space-y-1">
              {items.map((example) => (
                <li key={example.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(example)}
                    className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:shadow-ring"
                  >
                    <div className="text-sm font-medium text-fg">
                      {getExampleName(example, uiLocale)}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-muted">
                      {getExampleDescription(example, uiLocale)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

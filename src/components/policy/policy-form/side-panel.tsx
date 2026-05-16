'use client';

import { useState } from 'react';
import type { editor } from 'monaco-editor';
import { useTranslations } from 'next-intl';
import { Sparkles, BookOpen, LayoutTemplate, X } from 'lucide-react';
import { AIAssistantPanel } from '@/components/policy/ai-assistant-panel';
import { CNLSyntaxReferencePanel } from '@/components/policy/cnl-syntax-reference-panel';
import {
  POLICY_EXAMPLES,
  CATEGORY_LABELS,
  type PolicyExample,
  getExampleName,
  getExampleDescription,
  getExampleSource,
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

export type SidePanelTab = 'ai' | 'syntax' | 'templates';

export interface SidePanelProps {
  editor: editor.IStandaloneCodeEditor | null;
  cnlLocale: SupportedLocale;
  uiLocale: string;
  /** Apply a generated/template body to the form's main content. */
  onApplyContent: (content: string) => void;
  /** Apply a template — sets name + description + content together. */
  onApplyTemplate: (template: PolicyExample) => void;
  /** Close the entire side panel (parent collapses it). */
  onClose: () => void;
}

export function SidePanel({
  editor,
  cnlLocale,
  uiLocale,
  onApplyContent,
  onApplyTemplate,
  onClose,
}: SidePanelProps) {
  const t = useTranslations('policies.form');
  const [tab, setTab] = useState<SidePanelTab>('ai');

  return (
    <aside
      className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-bg shadow-sm"
      aria-label={t('sidePanelToggle')}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1" role="tablist">
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
            onSelect={onApplyTemplate}
            onApplyBody={onApplyContent}
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
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:shadow-ring',
        active
          ? 'bg-primary-subtle text-primary-hover'
          : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Templates tab                                                       */
/* ------------------------------------------------------------------ */

function TemplatesTab({
  uiLocale,
  cnlLocale,
  onSelect,
  onApplyBody,
}: {
  uiLocale: string;
  cnlLocale: SupportedLocale;
  onSelect: (t: PolicyExample) => void;
  onApplyBody: (body: string) => void;
}) {
  const categories = Object.keys(CATEGORY_LABELS) as Array<
    keyof typeof CATEGORY_LABELS
  >;
  const isZh = uiLocale.startsWith('zh');

  return (
    <div className="space-y-4 p-3">
      <p className="text-xs text-fg-muted">
        {isZh
          ? '点击模板会替换当前编辑器内容。'
          : 'Picking a template replaces the editor body.'}
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
                    onClick={() => {
                      onSelect(example);
                      onApplyBody(getExampleSource(example, cnlLocale));
                    }}
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

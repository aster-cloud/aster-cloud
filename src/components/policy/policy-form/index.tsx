/**
 * PolicyForm — shared editor shell for /policies/new and
 * /policies/[id]/edit.
 *
 * ============================================================
 * SECURITY MODEL — do not break this invariant.
 * ============================================================
 *
 * VALIDATE (real-time editor feedback):
 *   Runs entirely client-side via @aster-cloud/aster-lang-ts's
 *   `validateSyntaxWithSpan()` (see use-compile.ts). Source never
 *   leaves the browser; diagnostics paint as Monaco markers in
 *   the same tick. Cost: zero network, zero MITM surface.
 *
 * EXECUTE (any "Run" / "Test" button reachable from the dashboard):
 *   MUST POST to /api/policies/[id]/execute and pass only the
 *   `input` payload. The backend resolves the policy SOURCE by id
 *   from Postgres / the policy KV cache. The current source the
 *   user has typed but not saved is irrelevant — only persisted,
 *   ownership-checked content is ever interpreted.
 *
 * NEVER, from inside this form (or any other dashboard surface):
 *   - POST the editor buffer to /api/policies/evaluate-source
 *   - POST the editor buffer to /api/policies/[id]/execute as a
 *     `source` field
 *   - Pipe the editor buffer into ANY runtime path
 *
 * Why this matters:
 *   1. MITM hardening — even if a browser session is hijacked,
 *      what runs in prod is whatever's in the database, not what
 *      the attacker injects mid-flight.
 *   2. Mental-model contract — when a dashboard user clicks Run,
 *      they expect the result to match the version they last
 *      saved. Silently substituting the editor buffer creates
 *      ghost behavior the version history won't explain.
 *   3. Audit chain — DB-resolved execution is what the policy
 *      version table + executions log are keyed against. Source-
 *      from-buffer execution would orphan the audit trail.
 *
 * The /api/policies/evaluate-source endpoint *exists* (and is
 * actively promoted in aster-lang-dev's quickstart docs) for
 * developer experimentation — "no need to CREATE a policy first."
 * That is a separate, deliberate dev-experience API protected by
 * HMAC + InternalCallerFilter + login session. It is correct for
 * curl + SDKs. It is wrong for the dashboard editor.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { editor } from 'monaco-editor';
import { Link } from '@/i18n/navigation';
import { Breadcrumbs, buttonVariants, cn } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui';
import { normalizeLocale } from '@/data/policy-examples';

import { MetaSection } from './meta-section';
import { SidePanel, type SidePanelTab } from './side-panel';
import { StatusBar } from './status-bar';
import {
  usePolicyDraft,
  type PolicyDraftFields,
} from './use-policy-draft';
import { useUnsavedWarning } from './use-unsaved-warning';
import { usePolicyShortcuts } from './use-policy-shortcuts';
import { useCompile } from './use-compile';
import { useMonacoMarkers } from './use-monaco-markers';
import { useIsMobile } from './use-is-mobile';
import { EditorPalette } from './editor-palette';
import { CNLSyntaxConverterDialog } from '@/components/policy/cnl-syntax-converter-dialog';
import {
  type PolicyExample,
  getExampleSource,
} from '@/data/policy-examples';

const MonacoPolicyEditor = dynamic(
  () =>
    import('@/components/policy/monaco-policy-editor').then(
      (mod) => mod.MonacoPolicyEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full min-h-[500px] items-center justify-center rounded-lg bg-bg-muted text-sm text-fg-subtle"
        role="status"
        aria-label="Loading editor"
      >
        Loading editor…
      </div>
    ),
  },
);

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PolicyFormMode = 'create' | 'edit';

export type PolicyFormInitialFields = PolicyDraftFields;

export interface PolicySaveResult {
  /** Saved policy id — used to navigate to detail on "save and view". */
  id: string;
}

export interface PolicySaveError {
  message: string;
  /** Backend signalled the user should upgrade their plan. */
  upgrade?: boolean;
}

export interface PolicyFormProps {
  mode: PolicyFormMode;
  uiLocale: string;
  /** Existing policy id when editing; null for create. */
  policyId: string | null;
  /** Seed values for the form. */
  initial: PolicyFormInitialFields;
  /** Mode-specific page title. */
  title: string;
  subtitle: string;
  /** Persist the policy. Must throw / return error on failure. */
  onSave: (fields: PolicyDraftFields) => Promise<PolicySaveResult | PolicySaveError>;
  /** Where to navigate on Cancel. */
  cancelHref: string;
  /** Detail-page href builder for "save and view" navigation. */
  detailHrefFor: (id: string) => string;
  /** Breadcrumb trail for the top bar. */
  breadcrumbs: Array<{ label: string; href?: string }>;
}

/* ------------------------------------------------------------------ */
/* PolicyForm                                                          */
/* ------------------------------------------------------------------ */

export function PolicyForm({
  mode,
  uiLocale,
  policyId,
  initial,
  title,
  subtitle,
  onSave,
  cancelHref,
  detailHrefFor,
  breadcrumbs,
}: PolicyFormProps) {
  const router = useRouter();
  const t = useTranslations('policies.form');
  const tCommon = useTranslations('common');
  const cnlLocale = normalizeLocale(uiLocale);
  // Mobile users (< md) are here to review, not to author CNL —
  // swap Monaco for a read-only viewer so the page is usable on
  // phones without dragging in the editor's keyboard + completion
  // surface.
  const isMobile = useIsMobile();

  // ---------------------------------------------------------------
  // Form fields
  // ---------------------------------------------------------------
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [content, setContent] = useState(initial.content);
  const [isPublic, setIsPublic] = useState(initial.isPublic);
  const [groupId, setGroupId] = useState<string | null>(initial.groupId);
  const fields: PolicyDraftFields = useMemo(
    () => ({ name, description, content, isPublic, groupId }),
    [name, description, content, isPublic, groupId],
  );

  // ---------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------
  const [metaExpanded, setMetaExpanded] = useState(mode === 'create');
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [requestedTab, setRequestedTab] = useState<SidePanelTab | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [serverError, setServerError] = useState<PolicySaveError | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [converterOpen, setConverterOpen] = useState(false);

  // Editor instance is captured imperatively. We also hold a state
  // boolean so child hooks (markers, jump-to-line) re-run after
  // monaco's async onMount — refs alone won't trigger a re-render.
  const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  // Resolve the live instance only after onMount has fired so hook
  // deps see a stable value.
  const editorForHooks = editorReady ? editorInstanceRef.current : null;

  // ---------------------------------------------------------------
  // Compile-on-type
  // ---------------------------------------------------------------
  const compile = useCompile({ source: content, locale: cnlLocale });

  // Bind diagnostics onto Monaco as inline markers.
  useMonacoMarkers(editorForHooks, compile.diagnostics);

  // ---------------------------------------------------------------
  // Editor command helpers
  // ---------------------------------------------------------------

  /** Insert a text snippet at the current cursor (or replace selection). */
  const insertAtCursor = useCallback((snippet: string) => {
    const ed = editorInstanceRef.current;
    if (!ed) {
      // No editor yet — fall back to appending. Rare edge: palette
      // opened before onMount completed.
      setContent((prev) => (prev ? prev + '\n' + snippet : snippet));
      return;
    }
    const selection = ed.getSelection();
    const range = selection ?? {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    };
    ed.executeEdits('aster.insert-snippet', [
      {
        range,
        text: snippet,
        forceMoveMarkers: true,
      },
    ]);
    ed.focus();
  }, []);

  /** Insert a template at the cursor (or replace selection). Sets a
   *  default name only when the name field is empty so we don't
   *  clobber whatever the user already typed. */
  const insertTemplateAtCursor = useCallback(
    (tpl: PolicyExample) => {
      const body = getExampleSource(tpl, cnlLocale);
      insertAtCursor(body);
      setName((prev) => prev || tpl.id);
      toast.success(t('templateInsertedAtCursor'));
    },
    [cnlLocale, insertAtCursor, t],
  );

  /** Trigger Monaco's built-in format-document action. */
  const formatDocument = useCallback(() => {
    const ed = editorInstanceRef.current;
    if (!ed) return;
    void ed.getAction('editor.action.formatDocument')?.run();
  }, []);

  // ---------------------------------------------------------------
  // Draft persistence
  // ---------------------------------------------------------------
  const {
    isDirty,
    lastSavedAt,
    pendingDraft,
    acceptPendingDraft,
    discardPendingDraft,
    clearDraft,
  } = usePolicyDraft({
    policyId,
    fields,
    baseline: initial,
  });

  useUnsavedWarning(isDirty && !isSaving);

  // Show the restore-draft toast at most once, after the form mounts.
  // sonner is mounted at the locale-layout level (see [locale]/layout.tsx)
  // so we can call it here without any provider plumbing.
  const restorePromptedRef = useRef(false);
  useEffect(() => {
    if (restorePromptedRef.current) return;
    if (!pendingDraft) return;
    restorePromptedRef.current = true;
    const id = toast(t('draftRestoreTitle'), {
      description: t('draftRestoreBody', { time: 'recently' }),
      duration: 10_000,
      action: {
        label: t('draftRestore'),
        onClick: () => {
          setName(pendingDraft.name);
          setDescription(pendingDraft.description);
          setContent(pendingDraft.content);
          setIsPublic(pendingDraft.isPublic);
          setGroupId(pendingDraft.groupId);
          acceptPendingDraft();
        },
      },
      cancel: {
        label: t('draftDiscard'),
        onClick: () => {
          discardPendingDraft();
        },
      },
    });
    return () => {
      // If the user navigates away before responding, dismiss the toast.
      toast.dismiss(id);
    };
  }, [
    pendingDraft,
    t,
    acceptPendingDraft,
    discardPendingDraft,
  ]);

  // ---------------------------------------------------------------
  // Save handlers
  // ---------------------------------------------------------------

  /** Validate; return true if save can proceed. */
  const validate = useCallback((): boolean => {
    if (name.trim().length === 0) {
      setNameError(
        uiLocale.startsWith('zh') ? '请填写策略名称' : 'Name is required',
      );
      setMetaExpanded(true);
      return false;
    }
    setNameError(null);
    return true;
  }, [name, uiLocale]);

  /** Submit. Optional callback to fire on success (e.g. navigate). */
  const handleSubmit = useCallback(
    async (afterSave?: (id: string) => void): Promise<void> => {
      if (!validate()) return;
      if (isSaving) return;
      setIsSaving(true);
      setServerError(null);
      try {
        const result = await onSave(fields);
        if ('message' in result) {
          setServerError(result);
          toast.error(t('saveFailed'), { description: result.message });
          return;
        }
        toast.success(t('saveSuccess'));
        clearDraft();
        afterSave?.(result.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : t('saveFailed');
        setServerError({ message });
        toast.error(t('saveFailed'), { description: message });
      } finally {
        setIsSaving(false);
      }
    },
    [validate, isSaving, onSave, fields, clearDraft, t],
  );

  const onSaveOnly = useCallback(
    () => handleSubmit((id) => router.push(detailHrefFor(id))),
    [handleSubmit, router, detailHrefFor],
  );

  // ⌘Enter — save and view (same nav as create-mode default).
  const onSaveAndView = useCallback(
    () => handleSubmit((id) => router.push(detailHrefFor(id))),
    [handleSubmit, router, detailHrefFor],
  );

  // ---------------------------------------------------------------
  // Shortcuts
  // ---------------------------------------------------------------
  usePolicyShortcuts({
    onSave: onSaveOnly,
    onSaveAndView,
    onTogglePanel: () => setSidePanelOpen((v) => !v),
    onPalette: () => setPaletteOpen(true),
    isPaletteContextActive: () => {
      // Take over ⌘K whenever the editor or any element inside our
      // form is focused — otherwise the dashboard's global ⌘K (route
      // jump) still wins, which is the right call when the user is
      // browsing the dashboard surface.
      if (paletteOpen) return true;
      const ed = editorInstanceRef.current;
      if (ed && ed.hasTextFocus()) return true;
      const active = document.activeElement;
      if (active && active.closest('[data-policy-form-root]')) return true;
      return false;
    },
    onEscape: () => {
      if (paletteOpen) {
        setPaletteOpen(false);
        return;
      }
      if (sidePanelOpen) {
        setSidePanelOpen(false);
        return;
      }
      // Otherwise blur the active editable element so Esc doesn't
      // feel like a no-op.
      const el = document.activeElement;
      if (
        el &&
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      ) {
        el.blur();
      }
    },
  });

  // ---------------------------------------------------------------
  // Cancel — soft confirm when dirty.
  // ---------------------------------------------------------------
  const handleCancelClick = (e: React.MouseEvent) => {
    if (!isDirty) return;
    e.preventDefault();
    setCancelConfirmOpen(true);
  };

  return (
    <div
      data-policy-form-root
      // Natural-flow layout (NOT a forced 100vh shell) so the
      // surrounding dashboard <main> can scroll normally. The editor
      // panel takes a fixed-ish height (clamp between 500 and 720 px
      // based on viewport) instead of trying to stretch into a flex
      // parent — that kept growing without bound when main had no
      // height ceiling, producing the "endless page" symptom.
      className="flex flex-col gap-3"
    >
      {/* ----- Top bar ----- */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
        <div className="min-w-0">
          <Breadcrumbs className="mb-1" items={breadcrumbs} />
          <h1 className="truncate font-display text-xl font-semibold tracking-tight text-fg sm:text-2xl">
            {title}
          </h1>
          <p className="mt-0.5 truncate text-xs text-fg-muted sm:text-sm">
            {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={cancelHref}
            onClick={handleCancelClick}
            className={buttonVariants({ variant: 'secondary', size: 'md' })}
          >
            {tCommon('cancel')}
          </Link>
          {/* Mobile is read-only — hide Save so users don't think
              their typing (which can't happen) is being persisted. */}
          {!isMobile && (
            <button
              type="button"
              onClick={onSaveOnly}
              disabled={isSaving}
              className={cn(
                buttonVariants({ variant: 'primary', size: 'md' }),
                'gap-2',
              )}
            >
              {isSaving
                ? mode === 'create'
                  ? t('creating')
                  : t('saving')
                : mode === 'create'
                  ? t('create')
                  : t('save')}
            </button>
          )}
        </div>
      </header>

      {/* ----- Server error banner ----- */}
      {serverError && (
        <div
          role="alert"
          className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger sm:px-6"
        >
          {serverError.message}
          {serverError.upgrade && (
            <Link
              href={`/${uiLocale}/billing`}
              className="ml-3 underline hover:no-underline"
            >
              {t('viewPlans')}
            </Link>
          )}
        </div>
      )}

      {/* ----- Meta section ----- */}
      <div className="px-4 sm:px-6">
        <MetaSection
          name={name}
          description={description}
          groupId={groupId}
          isPublic={isPublic}
          locale={uiLocale}
          expanded={metaExpanded}
          onExpandedChange={setMetaExpanded}
          onNameChange={(v) => {
            setName(v);
            if (nameError && v.trim().length > 0) setNameError(null);
          }}
          onDescriptionChange={setDescription}
          onGroupIdChange={setGroupId}
          onIsPublicChange={setIsPublic}
          nameError={nameError}
        />
      </div>

      {/* ----- Editor + Side panel ----- */}
      <div
        className="flex gap-3 px-4 sm:px-6"
        // Clamp the editor row to a usable working height. Below this,
        // the page just gains a natural scrollbar — no broken flex.
        style={{ height: 'clamp(500px, calc(100vh - 16rem), 720px)' }}
      >
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-bg shadow-sm overflow-hidden">
          {isMobile ? (
            // Read-only viewer for phones. Pre-formatted text with the
            // same monospace stack Monaco uses, so syntax highlighting's
            // absence is the only visible difference. The empty-state
            // placeholder mirrors the editor's contentPlaceholder text
            // so a brand-new policy doesn't surprise the user with a
            // blank gray box.
            <pre
              className="m-0 h-full overflow-auto p-4 font-mono text-sm text-fg whitespace-pre-wrap break-words"
              aria-label={t('content')}
            >
              {content || t('contentPlaceholder')}
            </pre>
          ) : (
            <MonacoPolicyEditor
              value={content}
              onChange={setContent}
              locale={cnlLocale}
              height="100%"
              placeholder={t('contentPlaceholder')}
              onEditorReady={(ed) => {
                editorInstanceRef.current = ed;
                // Trigger one re-render so marker / palette hooks
                // depending on the editor instance can pick it up.
                setEditorReady(true);
              }}
              enableAICompletion
              onToggleAIPanel={() => {
                setRequestedTab('ai');
                setSidePanelOpen(true);
              }}
            />
          )}
        </div>
        {sidePanelOpen && (
          <div className="hidden w-[28rem] lg:flex">
            <SidePanel
              editor={editorInstanceRef.current}
              cnlLocale={cnlLocale}
              uiLocale={uiLocale}
              onApplyContent={(body) => setContent(body)}
              onApplyTemplate={(tpl) => {
                // PR-3: insert at cursor position rather than wiping
                // whatever the user already typed. Preserves the form
                // body and just adds the template snippet inline.
                insertTemplateAtCursor(tpl);
              }}
              onClose={() => setSidePanelOpen(false)}
              compileState={compile.state}
              compileDiagnostics={compile.diagnostics}
              compileModule={compile.module}
              onJumpToLine={(line, column) => {
                const ed = editorInstanceRef.current;
                if (!ed) return;
                ed.revealLineInCenter(line);
                ed.setPosition({ lineNumber: line, column });
                ed.focus();
              }}
              initialTab={requestedTab}
            />
          </div>
        )}
      </div>

      {/* ----- Status bar ----- */}
      <StatusBar
        content={content}
        cnlLocale={cnlLocale}
        isDirty={isDirty}
        lastSavedAt={lastSavedAt}
        compileState={compile.state}
        compileDiagnostics={compile.diagnostics}
        compileTransportError={compile.transportError}
        onCompileChipClick={() => {
          setRequestedTab('decision');
          setSidePanelOpen(true);
        }}
      />

      {/* ----- Editor command palette ----- */}
      <EditorPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        uiLocale={uiLocale}
        onAskAI={() => {
          setRequestedTab('ai');
          setSidePanelOpen(true);
        }}
        onInsertTemplate={insertTemplateAtCursor}
        onConvertLocale={() => setConverterOpen(true)}
        onFormat={formatDocument}
        onSave={onSaveOnly}
        onSaveAndView={onSaveAndView}
        onTogglePanel={() => setSidePanelOpen((v) => !v)}
        onShowSyntax={() => {
          setRequestedTab('syntax');
          setSidePanelOpen(true);
        }}
        onShowDecision={() => {
          setRequestedTab('decision');
          setSidePanelOpen(true);
        }}
      />

      {/* ----- CNL locale converter dialog ----- */}
      <CNLSyntaxConverterDialog
        isOpen={converterOpen}
        onClose={() => setConverterOpen(false)}
        content={content}
        currentLocale={cnlLocale}
        uiLocale={uiLocale}
        onApply={(converted) => {
          setContent(converted);
        }}
      />

      {/* ----- Cancel confirmation ----- */}
      <ConfirmDialog
        isOpen={cancelConfirmOpen}
        title={t('unsavedLeaveWarning')}
        description=""
        confirmLabel={tCommon('cancel')}
        cancelLabel={uiLocale.startsWith('zh') ? '继续编辑' : 'Keep editing'}
        variant="warning"
        onCancel={() => setCancelConfirmOpen(false)}
        onConfirm={() => {
          // Wipe draft so we don't re-offer to restore what the
          // user explicitly chose to discard.
          clearDraft();
          router.push(cancelHref);
        }}
      />
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { editor } from 'monaco-editor';
import { Link } from '@/i18n/navigation';
import { Breadcrumbs, buttonVariants, cn } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
    onEscape: () => {
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
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* ----- Top bar ----- */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-bg px-4 py-3 sm:px-6">
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
      <div className="px-4 pt-3 sm:px-6">
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
      <div className="flex min-h-0 flex-1 gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border bg-bg shadow-sm">
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
        </div>
        {sidePanelOpen && (
          <div className="hidden min-h-0 w-[28rem] lg:flex">
            <SidePanel
              editor={editorInstanceRef.current}
              cnlLocale={cnlLocale}
              uiLocale={uiLocale}
              onApplyContent={(body) => setContent(body)}
              onApplyTemplate={(tpl) => {
                // Replacing-the-form behavior matches the legacy
                // template dropdown. PR-3 will switch this to
                // insert-at-cursor.
                setName((prev) => prev || tpl.id);
                setMetaExpanded(true);
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

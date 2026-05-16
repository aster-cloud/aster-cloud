'use client';

import { useEffect } from 'react';

/**
 * Keyboard shortcuts for the policy form.
 *
 *   ⌘S / Ctrl+S       → Save
 *   ⌘Enter / Ctrl+Enter → Save and view (open the detail page after save)
 *   ⌘B / Ctrl+B       → Toggle side panel
 *   ⌘K / Ctrl+K       → Open page-local command palette (when allowed
 *                       — typically when the editor is the focused area)
 *   Esc               → onEscape (callee decides: close panel, blur, etc.)
 *
 * ⌘K is special: a global dashboard ⌘K already exists for route
 * navigation (CommandPalette in dashboard layout). The global handler
 * skips when the active element is an editable input (its own
 * heuristic). For the policy editor we WANT to intercept: when
 * `isPaletteContextActive()` returns true, we preventDefault here
 * BEFORE the global handler sees it.
 *
 * Shortcut handling is mounted at the form root rather than per-input
 * because most are global to the editing session.
 */
export interface PolicyShortcutHandlers {
  onSave: () => void;
  onSaveAndView: () => void;
  onTogglePanel: () => void;
  onEscape: () => void;
  /** Optional — when present, ⌘K intercepts and calls this. */
  onPalette?: () => void;
  /**
   * Predicate: should ⌘K open the in-editor palette right now?
   * Typically `true` when the editor has focus, the palette is
   * already open, or the form is in a state where local commands
   * are the obvious thing.
   */
  isPaletteContextActive?: () => boolean;
}

function isMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

export function usePolicyShortcuts(handlers: PolicyShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘Enter / Ctrl+Enter — check this BEFORE ⌘S so the Enter key
      // doesn't trigger a save AND a save-and-view.
      if (isMod(e) && e.key === 'Enter') {
        e.preventDefault();
        handlers.onSaveAndView();
        return;
      }
      if (isMod(e) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handlers.onSave();
        return;
      }
      if (isMod(e) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        handlers.onTogglePanel();
        return;
      }
      if (
        isMod(e) &&
        (e.key === 'k' || e.key === 'K') &&
        handlers.onPalette &&
        (handlers.isPaletteContextActive?.() ?? true)
      ) {
        // Stop propagation so the global ⌘K palette (dashboard nav)
        // doesn't also open on top of us.
        e.preventDefault();
        e.stopPropagation();
        handlers.onPalette();
        return;
      }
      if (e.key === 'Escape') {
        // Don't preventDefault on Escape — Monaco and dialogs rely on
        // their own Esc handling. We just notify the parent.
        handlers.onEscape();
        return;
      }
    };
    // Capture-phase listener so we intercept ⌘K before the dashboard's
    // global palette has a chance to react. The dashboard palette
    // attaches in bubble, so we're guaranteed to win when both are
    // mounted.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handlers]);
}

'use client';

import { useEffect } from 'react';

/**
 * Keyboard shortcuts for the policy form.
 *
 *   ⌘S / Ctrl+S       → Save
 *   ⌘Enter / Ctrl+Enter → Save and view (open the detail page after save)
 *   ⌘B / Ctrl+B       → Toggle side panel
 *   Esc               → onEscape (callee decides: close panel, blur, etc.)
 *
 * Shortcut handling is mounted at the form root rather than per-input
 * because most are global to the editing session (Save, toggle panel),
 * and inputs inside the form forward keystrokes upward unless they
 * mean something locally. ⌘S also needs preventDefault on the document
 * level to suppress the browser's own save-page dialog.
 *
 * The handler reads from a ref-shaped `handlers` object so consumers
 * can recreate inline arrow functions on every render without making
 * us re-mount the listener.
 */
export interface PolicyShortcutHandlers {
  onSave: () => void;
  onSaveAndView: () => void;
  onTogglePanel: () => void;
  onEscape: () => void;
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
      if (e.key === 'Escape') {
        // Don't preventDefault on Escape — Monaco and dialogs rely on
        // their own Esc handling. We just notify the parent.
        handlers.onEscape();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}

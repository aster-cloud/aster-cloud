'use client';

import { useEffect } from 'react';

/**
 * `beforeunload` guard for unsaved changes.
 *
 * Limitation worth knowing: this catches hard navigation away from
 * the tab (reload, close, address-bar change). It does NOT catch
 * Next.js soft navigations (Link clicks, router.push) because
 * App Router has no public router-event API that lets us intercept
 * + cancel. Soft-nav handling needs an in-app affordance instead
 * (we use the page's own "Cancel" button confirming when dirty, see
 * PolicyForm). When the App Router exposes nav intercepts we can
 * upgrade this hook to cover that too.
 *
 * The browser ignores the custom message in modern Chrome/Firefox/
 * Safari and shows its own generic prompt — calling preventDefault
 * + returnValue is still required to trigger that prompt at all.
 */
export function useUnsavedWarning(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy Chrome quirk — both are needed.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [enabled]);
}

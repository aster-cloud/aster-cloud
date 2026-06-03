'use client';

/**
 * Cross-tab docs session signal — fire-and-forget client component.
 *
 * The OAuth login flow leaves the login page entirely (redirect chain
 * through the provider), so it cannot call `signalDocsSessionRefresh()`
 * from its success branch. Instead, mount this component once in any
 * route that the user lands on after an OAuth callback (typically the
 * dashboard layout). It signals `in` once per mount, which causes any
 * open `/docs/*` tab to revalidate its session probe and pick up the
 * new authenticated state.
 *
 * Each signal causes one revalidation probe per open docs tab. That
 * cost is bounded by user navigation — the dashboard is not visited
 * in a tight loop — and a generation counter inside the docs hook
 * supersedes any in-flight probe when a newer tick arrives, so back-
 * to-back ticks never produce racing writes.
 *
 * Renders nothing.
 */

import { useEffect } from 'react';
import { signalDocsSessionRefresh } from '@/lib/docs/use-docs-session';

export function DocsSessionSignal() {
  useEffect(() => {
    signalDocsSessionRefresh();
  }, []);
  return null;
}

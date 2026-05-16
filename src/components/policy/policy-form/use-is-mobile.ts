'use client';

import { useEffect, useState } from 'react';

/**
 * Detect whether the viewport is below the Tailwind `md` breakpoint
 * (< 768 px). Default `false` on first render so the SSR output
 * matches the desktop tree — the real value flips in on first
 * effect tick. matchMedia change listener keeps the value live as
 * the user resizes / rotates.
 *
 * Used by PolicyForm to swap the Monaco editor for a read-only
 * viewer on phones. Mobile users in this product (audit context:
 * compliance officers, approvers) are here to *review*, not to
 * write CNL; full Monaco is unusable below ~600 px wide.
 */
export function useIsMobile(query = '(max-width: 767px)'): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return isMobile;
}

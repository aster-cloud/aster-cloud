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
    // SSR 稳定默认 false，hydration 后按 matchMedia（外部环境）同步真实值，
    // 并挂 change 监听保持实时——从外部同步，非渲染循环。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return isMobile;
}

'use client';

/**
 * Fire-and-forget client component that records the current page's
 * visit into the local `aster.docs.visits` cache. Mounted globally
 * in the docs layout so every MDX route is captured, regardless of
 * whether the page rewrite generator is rerun.
 *
 * The visible page title is read from the DOM `<h1>` inside the
 * effect so the recording always reflects the current page (rather
 * than the H1 of whichever page rendered the previous time React
 * walked the tree). Reading inside the effect also defers the
 * lookup until after paint, when the H1 is guaranteed to be in the
 * DOM regardless of suspense or streaming.
 *
 * Renders nothing.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import {
  pushVisit,
  readVisits,
  writeVisits,
} from '@/lib/docs/use-visit-tracking';

function slugFromPathname(pathname: string): string {
  const stripped = pathname.replace(/^\/[a-z]{2}(?=\/)/, '');
  const m = stripped.match(/^\/docs\/(.+?)\/?$/);
  return m?.[1] ?? '';
}

function readTitleFromDOM(): string {
  if (typeof document === 'undefined') return '';
  const h1 = document.querySelector<HTMLHeadingElement>(
    'article.docs-article h1',
  );
  return h1?.textContent?.trim() ?? '';
}

export function DocsVisitRecorder() {
  const pathname = usePathname() ?? '/';
  // Re-run on every pathname change so navigation between docs
  // pages records each visit in turn.
  useEffect(() => {
    const slug = slugFromPathname(pathname);
    if (!slug) return;
    // Title is read inside the effect — by this point React has
    // committed the new layout and the page's H1 is in the DOM.
    const title = readTitleFromDOM();
    if (!title) return;
    const next = pushVisit(readVisits(), { slug, title, ts: Date.now() });
    writeVisits(next);
  }, [pathname]);
  return null;
}

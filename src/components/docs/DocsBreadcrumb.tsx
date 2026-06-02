'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';

/**
 * Auto-derived breadcrumb for /docs/* pages.
 *
 * Strategy: parse the locale-stripped pathname into segments, title-case
 * each, render as a chain. The leaf segment is non-clickable; ancestors
 * link to their respective parent paths.
 *
 * Why we don't reuse <Breadcrumbs> from @aster-cloud/ui here:
 *   - That wrapper expects a hand-built item list, which means every
 *     /docs/* page would have to pass props (boilerplate × 37 pages).
 *   - The docs IA is regular (slash-separated, no special routing),
 *     so derivation is reliable.
 */
function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
    .join(' ');
}

export function DocsBreadcrumb() {
  const t = useTranslations();
  const pathname = usePathname();
  const segs = pathname.replace(/^\/+|\/+$/g, '').split('/'); // ["docs","example"]
  if (segs.length <= 1) return null;

  // segs always starts with "docs". Build cumulative hrefs.
  const items = segs.map((seg, i) => {
    const href = '/' + segs.slice(0, i + 1).join('/');
    const isLast = i === segs.length - 1;
    return {
      label: i === 0 ? t('docs.breadcrumb.root') : titleCase(seg),
      href,
      isLast,
    };
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-sm text-fg-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={it.href} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {it.isLast ? (
              <span aria-current="page" className="text-fg">
                {it.label}
              </span>
            ) : (
              <Link href={it.href} className="hover:text-fg transition-colors">
                {it.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

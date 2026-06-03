import { permanentRedirect } from 'next/navigation';

/**
 * Resolve a docs section-parent's canonical first-child URL for the
 * current locale and 308-redirect there.
 *
 * Used by `src/app/[locale]/docs/**\/page.tsx` files that exist only to
 * give the URL segment a valid landing — without these, breadcrumb
 * hover-prefetch RSC requests hit a non-route and 404. The redirect
 * target is a content URL (no further redirect), so the chain is at
 * most one hop.
 *
 * Locale prefix follows `localePrefix: 'as-needed'` from
 * `src/i18n/navigation.ts`: the default locale (en) serves bare URLs;
 * zh/de keep their `/zh` or `/de` prefix.
 *
 * 308 (vs 307) because these are permanent canonical indirections —
 * the section URL itself never holds content, the first-child URL is
 * the authoritative landing. SEO crawlers update their index
 * accordingly.
 *
 * @param locale  Validated locale string from the page params
 * @param child   Path under `/docs/` to redirect to, no leading slash
 *                (e.g. `'api/policies/evaluate'`). The redirect target
 *                must be a leaf page, not another section parent — the
 *                callers wire this from `src/lib/docs/sidebar.ts`
 *                first-item entries, so a sidebar reorder is the only
 *                way the value drifts.
 */
export function redirectToFirstChild(locale: string, child: string): never {
  const prefix = locale === 'en' ? '' : `/${locale}`;
  permanentRedirect(`${prefix}/docs/${child}`);
}

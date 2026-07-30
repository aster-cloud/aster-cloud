/**
 * Pure helpers used by `<DocsTrustFooter>`. Extracted into a no-React
 * module so unit tests can import them without dragging next-intl /
 * next/navigation into the vitest environment (which can't resolve
 * those packages — the same constraint that lives in Phase 3 build-
 * callback.ts).
 *
 * The component re-exports these helpers under the same name so any
 * existing import-from-DocsTrustFooter call site keeps working.
 */

/**
 * GitHub issue URL builder. Pre-fills title + body so a reader who
 * spots an inaccuracy or suggestion can open an issue in two clicks.
 * The repo is hardcoded; if it changes, this is the only place to
 * update.
 */
export function buildSuggestEditUrl(routeSlug: string, locale: string): string {
  const params = new URLSearchParams({
    title: `Docs: ${routeSlug}`,
    body: [
      `Page: ${routeSlug}`,
      `Locale: ${locale}`,
      '',
      '## Suggested change',
      '',
      '<!-- describe the change, or paste the existing text and the fix below -->',
    ].join('\n'),
    labels: 'docs,suggestion',
  });
  return `https://github.com/wontlost-ltd/aster-cloud/issues/new?${params.toString()}`;
}

/**
 * Format an ISO date using the active locale; falls back to the raw
 * value when the input is empty or unparseable.
 *
 * `YYYY-MM-DD` inputs are interpreted as UTC midnight by `new Date`,
 * which in non-UTC zones renders as the previous calendar day. We
 * force `timeZone: 'UTC'` so the rendered date matches the value the
 * author wrote in MDX frontmatter regardless of viewer's locale.
 */
export function formatDate(iso: string | undefined, locale: string): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

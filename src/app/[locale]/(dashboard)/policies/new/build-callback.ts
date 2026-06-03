/**
 * Build the canonical post-login destination for /policies/new. We
 * reconstruct `/[locale]/policies/new?<query>` so a docs deeplink
 * like `?from=docs&template=policy-evaluate-basic` survives the auth
 * bounce — without this, the editor would render empty after the
 * user signs in.
 *
 * Extracted into its own module so unit tests can exercise it without
 * loading the page module (which transitively pulls in next-intl /
 * next/navigation runtime — incompatible with the vitest mock setup).
 */
export function buildPoliciesNewCallback(
  locale: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value.length > 0) params.set(key, value[0]);
  }
  const qs = params.toString();
  const base = `/${locale}/policies/new`;
  return qs ? `${base}?${qs}` : base;
}

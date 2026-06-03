import { setRequestLocale } from 'next-intl/server';
import { redirectToFirstChild } from '@/lib/docs/section-redirect';

/**
 * /docs/getting-started — section-parent 308 redirect to the section's
 * first child. Exists so breadcrumb-hover RSC prefetches (`?_rsc=...`)
 * resolve instead of 404, and so the section URL is a valid landing
 * for bookmarks, sitemaps, and search engines.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function GettingStartedIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirectToFirstChild(locale, 'getting-started/overview');
}

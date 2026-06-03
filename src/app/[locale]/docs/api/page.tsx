import { setRequestLocale } from 'next-intl/server';
import { redirectToFirstChild } from '@/lib/docs/section-redirect';

/**
 * /docs/api — section-parent 308 redirect. Lands on the policy
 * evaluation reference (the most-used API entry point). Exists so
 * breadcrumb-hover RSC prefetches resolve and the URL is bookmarkable.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ApiIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirectToFirstChild(locale, 'api/policies/evaluate');
}

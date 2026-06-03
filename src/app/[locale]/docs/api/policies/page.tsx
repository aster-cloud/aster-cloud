import { setRequestLocale } from 'next-intl/server';
import { redirectToFirstChild } from '@/lib/docs/section-redirect';

/**
 * /docs/api/policies — section-parent 308 redirect to the first
 * policies endpoint reference. Prevents breadcrumb-hover 404s.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ApiPoliciesIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirectToFirstChild(locale, 'api/policies/evaluate');
}

import { setRequestLocale } from 'next-intl/server';
import { redirectToFirstChild } from '@/lib/docs/section-redirect';

/**
 * /docs/api/workflows — section-parent 308 redirect to the first
 * workflows endpoint reference. Prevents breadcrumb-hover 404s.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ApiWorkflowsIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirectToFirstChild(locale, 'api/workflows/events');
}

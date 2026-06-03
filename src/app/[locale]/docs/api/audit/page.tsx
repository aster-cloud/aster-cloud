import { setRequestLocale } from 'next-intl/server';
import { redirectToFirstChild } from '@/lib/docs/section-redirect';

/**
 * /docs/api/audit — section-parent 308 redirect to the first audit
 * endpoint reference. Prevents breadcrumb-hover 404s.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ApiAuditIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirectToFirstChild(locale, 'api/audit/logs');
}

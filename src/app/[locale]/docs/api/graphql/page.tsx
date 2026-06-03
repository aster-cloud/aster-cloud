import { setRequestLocale } from 'next-intl/server';
import { redirectToFirstChild } from '@/lib/docs/section-redirect';

/**
 * /docs/api/graphql — section-parent 308 redirect to the GraphQL
 * overview. Prevents breadcrumb-hover 404s.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ApiGraphqlIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirectToFirstChild(locale, 'api/graphql/overview');
}

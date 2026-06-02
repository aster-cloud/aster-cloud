import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

/**
 * /docs/ entry — Session-1 stub.
 *
 * Until the real getting-started + API docs are migrated (Sessions 3-4),
 * /docs/ just bounces to the example page so the route doesn't 404.
 * Once the real content lands, this redirects to
 * /docs/getting-started/overview instead.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DocsIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect(`/${locale}/docs/getting-started/overview`);
}

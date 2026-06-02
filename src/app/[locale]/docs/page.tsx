import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

/**
 * /docs/ entry — redirects the bare docs root to the first reader-
 * facing page. `getting-started/overview` is the canonical landing for
 * developers new to the platform; later sections are reachable via the
 * sidebar.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DocsIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirect(`/${locale}/docs/getting-started/overview`);
}

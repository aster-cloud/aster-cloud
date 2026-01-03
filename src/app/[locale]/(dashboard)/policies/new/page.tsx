import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NewPolicyContent } from './new-policy-content';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function NewPolicyPage({ params }: PageProps) {
  const { locale } = await params;
  const session = await getSession();

  if (!session?.user?.id) {
    redirect(`/${locale}/login`);
  }

  return <NewPolicyContent locale={locale} />;
}

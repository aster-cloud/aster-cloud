import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SecurityDashboard } from '@/components/security';
import { Breadcrumbs } from '@/components/ui';

export default async function SecurityPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const t = await getTranslations('security');
  const tNav = await getTranslations('dashboardNav');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 space-y-2">
        <Breadcrumbs
          items={[
            { label: tNav('dashboard'), href: '/dashboard' },
            { label: tNav('security') },
          ]}
        />
        <h1 className="text-2xl font-bold text-fg dark:text-white">
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-fg-muted dark:text-fg-subtle">
          {t('description')}
        </p>
      </div>

      <SecurityDashboard />
    </div>
  );
}

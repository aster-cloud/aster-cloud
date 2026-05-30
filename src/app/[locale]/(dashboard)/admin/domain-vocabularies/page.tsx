import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  getRecentBulkJobAggregates,
  getTopVocabularyUsers,
  getVocabularyAdminOverview,
} from '@/lib/domain-vocabulary-admin';
import { Breadcrumbs } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { VocabularyAdminContent } from './admin-content';

type Props = {
  params: Promise<{ locale: string }>;
};

/**
 * /admin/domain-vocabularies — operator dashboard for the F9 surface.
 *
 * Read-only at-a-glance numbers + a top-N user table + recent bulk job
 * status rollup. Auth is handled by the admin/layout.tsx gate; we just
 * fetch + render.
 */
export const dynamic = 'force-dynamic';

export default async function AdminDomainVocabulariesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.vocab');
  const tNav = await getTranslations('dashboardNav');
  const tAdminOverview = await getTranslations('admin.overview');

  // Each panel is fail-soft: a single failed query renders an empty card
  // rather than 500-ing the whole page (mirrors /admin/page.tsx pattern).
  const [overviewResult, topUsersResult, jobAggregatesResult] = await Promise.allSettled([
    getVocabularyAdminOverview(),
    getTopVocabularyUsers(10),
    getRecentBulkJobAggregates(),
  ]);

  return (
    <div>
      <Breadcrumbs
        className="mb-4"
        items={[
          { label: tNav('dashboard'), href: '/dashboard' },
          { label: tAdminOverview('title'), href: '/admin' },
          { label: t('title') },
        ]}
      />

      <div className="mb-6 flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
          {t('title')}
        </h1>
        <p className="text-sm text-fg-muted">{t('subtitle')}</p>
        <Link
          href="/domain-vocabularies"
          className="mt-1 text-xs text-primary underline-offset-2 hover:underline"
        >
          {t('openUserSurface')}
        </Link>
      </div>

      <VocabularyAdminContent
        overview={
          overviewResult.status === 'fulfilled' ? overviewResult.value : null
        }
        topUsers={
          topUsersResult.status === 'fulfilled' ? topUsersResult.value : []
        }
        jobAggregates={
          jobAggregatesResult.status === 'fulfilled'
            ? jobAggregatesResult.value
            : []
        }
        overviewError={
          overviewResult.status === 'rejected' ? String(overviewResult.reason) : null
        }
      />
    </div>
  );
}

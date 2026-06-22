'use client';

import { useTranslations } from 'next-intl';
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Container,
  DataTable,
  EmptyState,
  PageHeader,
  StatCard,
  type DataTableColumn,
} from '@/components/ui';
import { Link } from '@/i18n/navigation';

interface OverviewView {
  activeLinks: number;
  archivedLinks: number;
  uniqueUsers: number;
  globalTerms: number;
  snapshots: number;
  archivedSnapshots: number;
}

interface TopUserView {
  userId: string;
  email: string | null;
  activeLinks: number;
  plan: string;
}

interface JobAggregateView {
  status: string;
  count: number;
  totalRows: number;
}

interface VocabularyAdminContentProps {
  overview: OverviewView | null;
  topUsers: TopUserView[];
  jobAggregates: JobAggregateView[];
  overviewError: string | null;
}

export function VocabularyAdminContent({
  overview,
  topUsers,
  jobAggregates,
  overviewError,
}: VocabularyAdminContentProps) {
  const t = useTranslations('admin.vocab');

  const topUserColumns: DataTableColumn<TopUserView>[] = [
    {
      key: 'email',
      header: t('topUsers.email'),
      cell: (row) => (
        <span className="text-sm font-medium text-fg">{row.email ?? row.userId}</span>
      ),
    },
    {
      key: 'plan',
      header: t('topUsers.plan'),
      cell: (row) => <Badge variant="neutral">{row.plan}</Badge>,
    },
    {
      key: 'activeLinks',
      header: t('topUsers.activeLinks'),
      className: 'text-right',
      cell: (row) => (
        <span className="font-mono text-sm text-fg">{row.activeLinks}</span>
      ),
    },
  ];

  const jobColumns: DataTableColumn<JobAggregateView>[] = [
    {
      key: 'status',
      header: t('jobs.status'),
      cell: (row) => <Badge variant={mapStatusTone(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'count',
      header: t('jobs.count'),
      className: 'text-right',
      cell: (row) => (
        <span className="font-mono text-sm text-fg">{row.count}</span>
      ),
    },
    {
      key: 'totalRows',
      header: t('jobs.totalRows'),
      className: 'text-right',
      cell: (row) => (
        <span className="font-mono text-sm text-fg-muted">{row.totalRows}</span>
      ),
    },
  ];

  return (
    <Container size="wide" className="py-6 sm:py-10">
      {/* 顶层页：sidebar 已高亮 + PageHeader h1 显页名 → 删 Breadcrumbs（去三重重复）。 */}
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <Link
            href="/domain-vocabularies"
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            {t('openUserSurface')}
          </Link>
        }
        className="mb-6"
      />

      <div className="space-y-6">
        {overviewError ? (
          <Alert variant="danger">
            <AlertDescription>{t('overviewError')}</AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="vocab-admin-overview">
          <h2 id="vocab-admin-overview" className="sr-only">
            {t('overview.heading')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label={t('overview.activeLinks')}
              value={formatNumber(overview?.activeLinks ?? 0)}
              hint={t('overview.uniqueUsersHint', {
                n: overview?.uniqueUsers ?? 0,
              })}
            />
            <StatCard
              label={t('overview.globalTerms')}
              value={formatNumber(overview?.globalTerms ?? 0)}
              hint={t('overview.archivedHint', {
                n: overview?.archivedLinks ?? 0,
              })}
            />
            <StatCard
              label={t('overview.snapshots')}
              value={formatNumber(overview?.snapshots ?? 0)}
              hint={t('overview.archivedSnapshotsHint', {
                n: overview?.archivedSnapshots ?? 0,
              })}
            />
          </div>
        </section>

        <section aria-labelledby="vocab-admin-top-users">
          <Card>
            <CardHeader>
              <CardTitle id="vocab-admin-top-users">{t('topUsers.title')}</CardTitle>
            </CardHeader>
            <CardBody>
              <DataTable
                columns={topUserColumns}
                rows={topUsers}
                getRowKey={(row) => row.userId}
                aria-label={t('topUsers.title')}
                emptyState={
                  <EmptyState
                    title={t('topUsers.emptyTitle')}
                    description={t('topUsers.emptyDescription')}
                  />
                }
              />
            </CardBody>
          </Card>
        </section>

        <section aria-labelledby="vocab-admin-jobs">
          <Card>
            <CardHeader>
              <CardTitle id="vocab-admin-jobs">{t('jobs.title')}</CardTitle>
            </CardHeader>
            <CardBody>
              <DataTable
                columns={jobColumns}
                rows={jobAggregates}
                getRowKey={(row) => row.status}
                aria-label={t('jobs.title')}
                emptyState={
                  <EmptyState
                    title={t('jobs.emptyTitle')}
                    description={t('jobs.emptyDescription')}
                  />
                }
              />
            </CardBody>
          </Card>
        </section>
      </div>
    </Container>
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function mapStatusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'warning';
    default:
      return 'neutral';
  }
}

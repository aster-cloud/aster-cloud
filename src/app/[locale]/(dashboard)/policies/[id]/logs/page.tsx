import { getSession } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getTranslations } from 'next-intl/server';
import { LogsContent } from './logs-content';

async function getPolicyBasicInfo(userId: string, policyId: string) {
  const policy = await prisma.policy.findFirst({
    where: {
      id: policyId,
      userId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  return policy;
}

export default async function PolicyLogsPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const session = await getSession();
  if (!session?.user?.id) {
    redirect(`/${locale}/login`);
  }

  const policy = await getPolicyBasicInfo(session.user.id, id);

  if (!policy) {
    notFound();
  }

  const t = await getTranslations('policies');

  const translations = {
    logs: {
      title: t('logs.title'),
      backToPolicy: t('logs.backToPolicy'),
      noLogs: t('logs.noLogs'),
      filter: t('logs.filter'),
      all: t('logs.all'),
      success: t('logs.success'),
      failed: t('logs.failed'),
      source: t('logs.source'),
      web: t('logs.web'),
      api: t('logs.api'),
      cli: t('logs.cli'),
      dateRange: t('logs.dateRange'),
      from: t('logs.from'),
      to: t('logs.to'),
      apply: t('logs.apply'),
      reset: t('logs.reset'),
      executedAt: t('logs.executedAt'),
      duration: t('logs.duration'),
      version: t('logs.version'),
      input: t('logs.input'),
      output: t('logs.output'),
      error: t('logs.error'),
      showMore: t('logs.showMore'),
      showLess: t('logs.showLess'),
      page: t('logs.page'),
      of: t('logs.of'),
      previous: t('logs.previous'),
      next: t('logs.next'),
      stats: t('logs.stats'),
      totalExecutions: t('logs.totalExecutions'),
      successRate: t('logs.successRate'),
      avgDuration: t('logs.avgDuration'),
      recentActivity: t('logs.recentActivity'),
      loadError: t('logs.loadError'),
    },
  };

  return <LogsContent policyId={id} policyName={policy.name} translations={translations} locale={locale} />;
}

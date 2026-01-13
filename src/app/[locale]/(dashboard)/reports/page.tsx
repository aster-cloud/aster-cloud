import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getComplianceReports } from '@/lib/compliance';
import { ReportsContent } from './reports-content';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ReportsPage({ params }: PageProps) {
  const { locale } = await params;
  const session = await getSession();
  if (!session?.user?.id) {
    redirect(`/${locale}/login`);
  }

  const t = await getTranslations('reports');

  // 获取报告列表
  const reportsData = await getComplianceReports(session.user.id);

  // 序列化数据以便传递给客户端组件
  const reports = reportsData.map((report) => ({
    id: report.id,
    type: report.type,
    title: report.title,
    status: report.status as 'generating' | 'completed' | 'failed',
    data: report.data as {
      summary: {
        totalPolicies: number;
        policiesWithPII: number;
        totalExecutions: number;
        complianceScore: number;
      };
    } | null,
    createdAt: report.createdAt.toISOString(),
    completedAt: report.completedAt?.toISOString() ?? null,
  }));

  // 预渲染所有翻译字符串
  const translations = {
    title: t('title'),
    subtitle: t('subtitle'),
    upgradePlan: t('upgradePlan'),
    generateNew: t('generateNew'),
    generating: t('generating'),
    generateTemplate: t.raw('generate'),
    noReports: t('noReports'),
    generateFirst: t('generateFirst'),
    typeTemplate: t.raw('type'),
    createdTemplate: t.raw('created'),
    policiesAnalyzedTemplate: t.raw('policiesAnalyzed'),
    status: {
      completed: t('status.completed'),
      generating: t('status.generating'),
      failed: t('status.failed'),
    },
    reportTypes: {
      gdpr: {
        name: t('reportTypes.gdpr.name'),
        description: t('reportTypes.gdpr.description'),
      },
      hipaa: {
        name: t('reportTypes.hipaa.name'),
        description: t('reportTypes.hipaa.description'),
      },
      soc2: {
        name: t('reportTypes.soc2.name'),
        description: t('reportTypes.soc2.description'),
      },
      pci_dss: {
        name: t('reportTypes.pci_dss.name'),
        description: t('reportTypes.pci_dss.description'),
      },
    },
  };

  return (
    <ReportsContent
      initialReports={reports}
      translations={translations}
      locale={locale}
    />
  );
}

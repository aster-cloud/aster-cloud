import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getComplianceReport } from '@/lib/compliance';
import { ReportDetailContent } from './report-detail-content';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

export default async function ReportDetailPage({ params }: PageProps) {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const { id, locale } = await params;
  const t = await getTranslations('reports');

  // 获取报告详情
  const reportData = await getComplianceReport(session.user.id, id);

  // 序列化报告数据
  const report = reportData
    ? {
        id: reportData.id,
        type: reportData.type,
        title: reportData.title,
        status: reportData.status as 'generating' | 'completed' | 'failed',
        data: reportData.data as {
          summary: {
            totalPolicies: number;
            policiesWithPII: number;
            totalExecutions: number;
            complianceScore: number;
          };
          policies: Array<{
            id: string;
            name: string;
            piiFields: string[];
            executionCount: number;
            lastExecuted: string | null;
          }>;
          piiAnalysis: {
            fieldsDetected: string[];
            riskLevel: 'low' | 'medium' | 'high';
            recommendations: string[];
          };
          auditTrail: {
            recentExecutions: number;
            dataRetentionDays: number;
            lastAuditDate: string;
          };
          recommendations: string[];
          scores: {
            overall: number;
            categories: {
              dataProtection: number;
              accessControl: number;
              auditLogging: number;
            };
          };
        } | null,
        createdAt: reportData.createdAt.toISOString(),
        completedAt: reportData.completedAt?.toISOString() ?? null,
      }
    : null;

  // 预渲染所有翻译字符串
  const translations = {
    typeTemplate: t.raw('type'),
    createdTemplate: t.raw('created'),
    status: {
      completed: t('status.completed'),
      generating: t('status.generating'),
      failed: t('status.failed'),
    },
    detail: {
      failedToLoad: t('detail.failedToLoad'),
      reportNotFound: t('detail.reportNotFound'),
      backToReports: t('detail.backToReports'),
      generatingMessage: t('detail.generatingMessage'),
      failedMessage: t('detail.failedMessage'),
      complianceScore: t('detail.complianceScore'),
      overallCompliance: t('detail.overallCompliance'),
      categories: {
        dataProtection: t('detail.categories.dataProtection'),
        accessControl: t('detail.categories.accessControl'),
        auditLogging: t('detail.categories.auditLogging'),
      },
      summary: {
        totalPolicies: t('detail.summary.totalPolicies'),
        policiesWithPII: t('detail.summary.policiesWithPII'),
        totalExecutions: t('detail.summary.totalExecutions'),
        riskLevel: t('detail.summary.riskLevel'),
      },
      riskLevel: {
        low: t('detail.riskLevel.low'),
        medium: t('detail.riskLevel.medium'),
        high: t('detail.riskLevel.high'),
      },
      piiAnalysis: t('detail.piiAnalysis'),
      detectedFields: t('detail.detectedFields'),
      recommendations: t('detail.recommendations'),
      policiesAnalyzed: t('detail.policiesAnalyzed'),
      executionCountTemplate: t.raw('detail.executionCount'),
    },
  };

  return <ReportDetailContent report={report} translations={translations} locale={locale} />;
}

'use client';

import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format';
import { Breadcrumbs, Container, PageHeader } from '@/components/ui';

interface ComplianceReport {
  id: string;
  type: string;
  title: string;
  status: 'generating' | 'completed' | 'failed';
  data: {
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
  } | null;
  createdAt: string;
  completedAt: string | null;
}

interface Translations {
  typeTemplate: string;
  createdTemplate: string;
  status: {
    completed: string;
    generating: string;
    failed: string;
  };
  detail: {
    failedToLoad: string;
    reportNotFound: string;
    backToReports: string;
    generatingMessage: string;
    failedMessage: string;
    complianceScore: string;
    overallCompliance: string;
    categories: {
      dataProtection: string;
      accessControl: string;
      auditLogging: string;
    };
    summary: {
      totalPolicies: string;
      policiesWithPII: string;
      totalExecutions: string;
      riskLevel: string;
    };
    riskLevel: {
      low: string;
      medium: string;
      high: string;
    };
    piiAnalysis: string;
    detectedFields: string;
    recommendations: string;
    policiesAnalyzed: string;
    executionCountTemplate: string;
  };
}

// 简单模板插值
function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

interface ReportDetailContentProps {
  report: ComplianceReport | null;
  translations: Translations;
  locale: string;
}

export function ReportDetailContent({
  report,
  translations: t,
  locale,
}: ReportDetailContentProps) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-100';
    if (score >= 60) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  const getRiskBadge = (level: 'low' | 'medium' | 'high') => {
    const colors = {
      low: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[level]}`}>
        {t.detail.riskLevel[level]}
      </span>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
            {t.status.completed}
          </span>
        );
      case 'generating':
        return (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
            {t.status.generating}
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
            {t.status.failed}
          </span>
        );
      default:
        return null;
    }
  };

  if (!report) {
    return (
      <Container size="wide" className="py-6 sm:py-10">
        <div className="text-center py-12">
          <p className="text-red-600">{t.detail.reportNotFound}</p>
          <Link href="/reports" className="mt-4 text-primary hover:underline">
            {t.detail.backToReports}
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <Container size="wide" className="py-6 sm:py-10">
      <PageHeader
        title={report.title}
        subtitle={
          <span className="flex items-center space-x-3">
            {getStatusBadge(report.status)}
            <span className="text-sm text-fg-muted">
              {formatTemplate(t.typeTemplate, { type: report.type.toUpperCase() })}
            </span>
            <span className="text-sm text-fg-muted">
              {formatTemplate(t.createdTemplate, { date: formatDate(report.createdAt, locale) })}
            </span>
          </span>
        }
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: t.detail.backToReports, href: '/reports' },
              { label: report.title },
            ]}
          />
        }
        className="mb-6"
      />

      {report.status === 'generating' && (
        <div className="mb-6 rounded-md bg-blue-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="animate-spin h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-700">{t.detail.generatingMessage}</p>
            </div>
          </div>
        </div>
      )}

      {report.status === 'failed' && (
        <div className="mb-6 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{t.detail.failedMessage}</p>
        </div>
      )}

      {report.status === 'completed' && report.data && (
        <>
          {/* Compliance Score */}
          <div className="bg-bg shadow sm:rounded-lg mb-6">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium text-fg">{t.detail.complianceScore}</h3>
                  <p className="mt-1 text-sm text-fg-muted">{t.detail.overallCompliance}</p>
                </div>
                <div className={`text-5xl font-bold ${getScoreColor(report.data.summary.complianceScore)}`}>
                  {report.data.summary.complianceScore}%
                </div>
              </div>

              {/* Category Scores */}
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className={`rounded-lg p-4 ${getScoreBgColor(report.data.scores.categories.dataProtection)}`}>
                  <div className="text-sm font-medium text-fg-muted">{t.detail.categories.dataProtection}</div>
                  <div className={`text-2xl font-bold ${getScoreColor(report.data.scores.categories.dataProtection)}`}>
                    {report.data.scores.categories.dataProtection}%
                  </div>
                </div>
                <div className={`rounded-lg p-4 ${getScoreBgColor(report.data.scores.categories.accessControl)}`}>
                  <div className="text-sm font-medium text-fg-muted">{t.detail.categories.accessControl}</div>
                  <div className={`text-2xl font-bold ${getScoreColor(report.data.scores.categories.accessControl)}`}>
                    {report.data.scores.categories.accessControl}%
                  </div>
                </div>
                <div className={`rounded-lg p-4 ${getScoreBgColor(report.data.scores.categories.auditLogging)}`}>
                  <div className="text-sm font-medium text-fg-muted">{t.detail.categories.auditLogging}</div>
                  <div className={`text-2xl font-bold ${getScoreColor(report.data.scores.categories.auditLogging)}`}>
                    {report.data.scores.categories.auditLogging}%
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-4 mb-6">
            <div className="bg-bg overflow-hidden rounded-lg shadow px-4 py-5">
              <dt className="text-sm font-medium text-fg-muted truncate">{t.detail.summary.totalPolicies}</dt>
              <dd className="mt-1 text-2xl font-semibold text-fg">{report.data.summary.totalPolicies}</dd>
            </div>
            <div className="bg-bg overflow-hidden rounded-lg shadow px-4 py-5">
              <dt className="text-sm font-medium text-fg-muted truncate">{t.detail.summary.policiesWithPII}</dt>
              <dd className="mt-1 text-2xl font-semibold text-fg">{report.data.summary.policiesWithPII}</dd>
            </div>
            <div className="bg-bg overflow-hidden rounded-lg shadow px-4 py-5">
              <dt className="text-sm font-medium text-fg-muted truncate">{t.detail.summary.totalExecutions}</dt>
              <dd className="mt-1 text-2xl font-semibold text-fg">{report.data.summary.totalExecutions}</dd>
            </div>
            <div className="bg-bg overflow-hidden rounded-lg shadow px-4 py-5">
              <dt className="text-sm font-medium text-fg-muted truncate">{t.detail.summary.riskLevel}</dt>
              <dd className="mt-1">{getRiskBadge(report.data.piiAnalysis.riskLevel)}</dd>
            </div>
          </div>

          {/* PII Analysis */}
          {report.data.piiAnalysis.fieldsDetected.length > 0 && (
            <div className="bg-bg shadow sm:rounded-lg mb-6">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium text-fg mb-4">{t.detail.piiAnalysis}</h3>
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-fg mb-2">{t.detail.detectedFields}</h4>
                  <div className="flex flex-wrap gap-2">
                    {report.data.piiAnalysis.fieldsDetected.map((field) => (
                      <span
                        key={field}
                        className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {report.data.recommendations.length > 0 && (
            <div className="bg-bg shadow sm:rounded-lg mb-6">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium text-fg mb-4">{t.detail.recommendations}</h3>
                <ul className="space-y-2">
                  {report.data.recommendations.map((rec, index) => (
                    <li key={index} className="flex items-start">
                      <svg className="h-5 w-5 text-primary mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                      </svg>
                      <span className="text-sm text-fg">{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Policies Analyzed */}
          {report.data.policies.length > 0 && (
            <div className="bg-bg shadow sm:rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium text-fg mb-4">{t.detail.policiesAnalyzed}</h3>
                <ul className="divide-y divide-border">
                  {report.data.policies.map((policy) => (
                    <li key={policy.id} className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Link href={`/policies/${policy.id}`} className="text-sm font-medium text-primary hover:underline">
                            {policy.name}
                          </Link>
                          {policy.piiFields.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {policy.piiFields.map((field) => (
                                <span
                                  key={field}
                                  className="inline-flex items-center rounded bg-bg-muted px-1.5 py-0.5 text-xs text-fg-muted"
                                >
                                  {field}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-sm text-fg-muted">
                          {formatTemplate(t.detail.executionCountTemplate, { count: policy.executionCount })}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </Container>
  );
}

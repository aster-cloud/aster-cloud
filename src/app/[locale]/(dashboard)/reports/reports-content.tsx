'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format';
import { LoadingSkeleton } from '@/components/feedback/loading-skeleton';

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
  } | null;
  createdAt: string;
  completedAt: string | null;
}

interface Translations {
  title: string;
  subtitle: string;
  upgradePlan: string;
  generateNew: string;
  generating: string;
  generateTemplate: string;
  noReports: string;
  generateFirst: string;
  typeTemplate: string;
  createdTemplate: string;
  policiesAnalyzedTemplate: string;
  status: {
    completed: string;
    generating: string;
    failed: string;
  };
  reportTypes: {
    gdpr: { name: string; description: string };
    hipaa: { name: string; description: string };
    soc2: { name: string; description: string };
    pci_dss: { name: string; description: string };
  };
}

// 简单模板插值
function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

const REPORT_TYPE_IDS = ['gdpr', 'hipaa', 'soc2', 'pci_dss'] as const;

interface ReportsContentProps {
  initialReports: ComplianceReport[];
  translations: Translations;
  locale: string;
}

export function ReportsContent({
  initialReports,
  translations: t,
  locale,
}: ReportsContentProps) {
  const [reports, setReports] = useState<ComplianceReport[]>(initialReports);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [error, setError] = useState('');

  const fetchReports = async () => {
    try {
      const res = await fetch('/api/reports');
      if (!res.ok) throw new Error('Failed to fetch reports');
      const data = await res.json();
      setReports(data);
    } catch (err) {
      console.error(err);
    }
  };

  const generateReport = async (type: string) => {
    setIsGenerating(true);
    setError('');

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.upgrade) {
          setError(data.error);
        } else {
          throw new Error(data.error || 'Failed to generate report');
        }
        return;
      }

      // Refresh reports list
      await fetchReports();
      setSelectedType('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
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

  const getReportTypeName = (id: string): string => {
    const typeMap: Record<string, { name: string; description: string }> = {
      gdpr: t.reportTypes.gdpr,
      hipaa: t.reportTypes.hipaa,
      soc2: t.reportTypes.soc2,
      pci_dss: t.reportTypes.pci_dss,
    };
    return typeMap[id]?.name || id;
  };

  return (
    <div>
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t.subtitle}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          {error.includes('subscription') && (
            <Link href="/billing" className="text-sm font-medium text-red-700 underline">
              {t.upgradePlan}
            </Link>
          )}
        </div>
      )}

      {/* Generate Report */}
      <div className="bg-white shadow sm:rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            {t.generateNew}
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {REPORT_TYPE_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setSelectedType(id)}
                disabled={isGenerating}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  selectedType === id
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
                } disabled:opacity-50`}
              >
                <div className="font-medium text-gray-900">{t.reportTypes[id].name}</div>
                <div className="text-sm text-gray-500">{t.reportTypes[id].description}</div>
              </button>
            ))}
          </div>

          {selectedType && (
            <div className="mt-4">
              <button
                onClick={() => generateReport(selectedType)}
                disabled={isGenerating}
                className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    {t.generating}
                  </>
                ) : (
                  formatTemplate(t.generateTemplate, { type: getReportTypeName(selectedType) })
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reports List */}
      {isGenerating && (
        <div aria-live="polite" className="mb-4">
          <LoadingSkeleton lines={3} className="bg-white shadow sm:rounded-lg p-6" />
        </div>
      )}
      {reports.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-semibold text-gray-900">{t.noReports}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {t.generateFirst}
          </p>
        </div>
      ) : (
        <div className="bg-white shadow sm:rounded-lg overflow-hidden">
          <ul className="divide-y divide-gray-200">
            {reports.map((report) => (
              <li key={report.id}>
                <Link
                  href={`/reports/${report.id}`}
                  className="block hover:bg-gray-50"
                >
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <span className="text-sm font-medium text-indigo-600">
                          {report.title}
                        </span>
                        <span className="ml-2">{getStatusBadge(report.status)}</span>
                      </div>
                      {report.status === 'completed' && report.data && (
                        <span
                          className={`text-2xl font-bold ${getScoreColor(
                            report.data.summary.complianceScore
                          )}`}
                        >
                          {report.data.summary.complianceScore}%
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center text-sm text-gray-500">
                      <span>{formatTemplate(t.typeTemplate, { type: report.type.toUpperCase() })}</span>
                      <span className="mx-2">|</span>
                      <span>
                        {formatTemplate(t.createdTemplate, { date: formatDate(report.createdAt, locale) })}
                      </span>
                      {report.status === 'completed' && report.data && (
                        <>
                          <span className="mx-2">|</span>
                          <span>{formatTemplate(t.policiesAnalyzedTemplate, { count: report.data.summary.totalPolicies })}</span>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

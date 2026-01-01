'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

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

const REPORT_TYPES = [
  { id: 'gdpr', name: 'GDPR', description: 'General Data Protection Regulation' },
  { id: 'hipaa', name: 'HIPAA', description: 'Health Insurance Portability and Accountability Act' },
  { id: 'soc2', name: 'SOC 2', description: 'Service Organization Control 2' },
  { id: 'pci_dss', name: 'PCI-DSS', description: 'Payment Card Industry Data Security Standard' },
];

export default function ReportsPage() {
  const [reports, setReports] = useState<ComplianceReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const res = await fetch('/api/reports');
      if (!res.ok) throw new Error('Failed to fetch reports');
      const data = await res.json();
      setReports(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
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
            Completed
          </span>
        );
      case 'generating':
        return (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
            Generating...
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
            Failed
          </span>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            Generate compliance reports for your policies
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          {error.includes('subscription') && (
            <Link href="/billing" className="text-sm font-medium text-red-700 underline">
              Upgrade plan
            </Link>
          )}
        </div>
      )}

      {/* Generate Report */}
      <div className="bg-white shadow sm:rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Generate New Report
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {REPORT_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelectedType(type.id)}
                disabled={isGenerating}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  selectedType === type.id
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
                } disabled:opacity-50`}
              >
                <div className="font-medium text-gray-900">{type.name}</div>
                <div className="text-sm text-gray-500">{type.description}</div>
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
                    Generating...
                  </>
                ) : (
                  `Generate ${REPORT_TYPES.find((t) => t.id === selectedType)?.name} Report`
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reports List */}
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
          <h3 className="mt-2 text-sm font-semibold text-gray-900">No reports yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Generate your first compliance report above.
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
                      <span>Type: {report.type.toUpperCase()}</span>
                      <span className="mx-2">|</span>
                      <span>
                        Created: {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                      {report.status === 'completed' && report.data && (
                        <>
                          <span className="mx-2">|</span>
                          <span>{report.data.summary.totalPolicies} policies analyzed</span>
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

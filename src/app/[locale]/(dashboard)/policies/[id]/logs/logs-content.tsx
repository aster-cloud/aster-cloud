'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface ExecutionLog {
  id: string;
  success: boolean;
  input: unknown;
  output: unknown;
  error: string | null;
  duration: number;
  source: 'WEB' | 'API' | 'CLI';
  policyVersion: number | null;
  createdAt: string;
}

interface Stats {
  total: number;
  successful: number;
  failed: number;
  avgDuration: number;
  successRate: number;
  dailyStats: Array<{
    date: string;
    total: number;
    successful: number;
    failed: number;
  }>;
}

interface Translations {
  logs: {
    title: string;
    backToPolicy: string;
    noLogs: string;
    filter: string;
    all: string;
    success: string;
    failed: string;
    source: string;
    web: string;
    api: string;
    cli: string;
    dateRange: string;
    from: string;
    to: string;
    apply: string;
    reset: string;
    executedAt: string;
    duration: string;
    version: string;
    input: string;
    output: string;
    error: string;
    showMore: string;
    showLess: string;
    page: string;
    of: string;
    previous: string;
    next: string;
    stats: string;
    totalExecutions: string;
    successRate: string;
    avgDuration: string;
    recentActivity: string;
    loadError: string;
  };
}

interface LogsContentProps {
  policyId: string;
  policyName: string;
  translations: Translations;
  locale: string;
}

export function LogsContent({ policyId, policyName, translations: t, locale }: LogsContentProps) {
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // 筛选条件
  const [successFilter, setSuccessFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: '20',
      });

      if (successFilter) params.append('success', successFilter);
      if (sourceFilter) params.append('source', sourceFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const res = await fetch(`/api/policies/${policyId}/logs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch logs');

      const data = await res.json();
      setLogs(data.items || []);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (err) {
      setError(t.logs.loadError);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [policyId, page, successFilter, sourceFilter, startDate, endDate, t.logs.loadError]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/policies/${policyId}/logs?mode=stats&days=30`);
      if (!res.ok) return;

      const data = await res.json();
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [policyId]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const resetFilters = () => {
    setSuccessFilter('');
    setSourceFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'WEB':
        return t.logs.web;
      case 'API':
        return t.logs.api;
      case 'CLI':
        return t.logs.cli;
      default:
        return source;
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div className="flex items-center">
          <Link
            href={`/${locale}/policies/${policyId}`}
            className="text-gray-400 hover:text-gray-600 mr-2"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.logs.title}</h1>
            <p className="text-sm text-gray-500">{policyName}</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-4 mb-6">
          <div className="bg-white overflow-hidden rounded-lg shadow px-4 py-5">
            <dt className="text-sm font-medium text-gray-500 truncate">{t.logs.totalExecutions}</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">{stats.total}</dd>
          </div>
          <div className="bg-white overflow-hidden rounded-lg shadow px-4 py-5">
            <dt className="text-sm font-medium text-gray-500 truncate">{t.logs.success}</dt>
            <dd className="mt-1 text-2xl font-semibold text-green-600">{stats.successful}</dd>
          </div>
          <div className="bg-white overflow-hidden rounded-lg shadow px-4 py-5">
            <dt className="text-sm font-medium text-gray-500 truncate">{t.logs.failed}</dt>
            <dd className="mt-1 text-2xl font-semibold text-red-600">{stats.failed}</dd>
          </div>
          <div className="bg-white overflow-hidden rounded-lg shadow px-4 py-5">
            <dt className="text-sm font-medium text-gray-500 truncate">{t.logs.avgDuration}</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-900">
              {formatDuration(stats.avgDuration)}
            </dd>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <div>
            <label className="block text-sm font-medium text-gray-700">{t.logs.filter}</label>
            <select
              value={successFilter}
              onChange={(e) => {
                setSuccessFilter(e.target.value);
                setPage(1);
              }}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="">{t.logs.all}</option>
              <option value="true">{t.logs.success}</option>
              <option value="false">{t.logs.failed}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{t.logs.source}</label>
            <select
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setPage(1);
              }}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="">{t.logs.all}</option>
              <option value="WEB">{t.logs.web}</option>
              <option value="API">{t.logs.api}</option>
              <option value="CLI">{t.logs.cli}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{t.logs.from}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{t.logs.to}</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={resetFilters}
              className="w-full inline-flex justify-center items-center rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-200"
            >
              {t.logs.reset}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Logs List */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">{t.logs.noLogs}</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {logs.map((log) => (
              <li key={log.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        log.success
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {log.success ? t.logs.success : t.logs.failed}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
                      {getSourceLabel(log.source)}
                    </span>
                    {log.policyVersion && (
                      <span className="text-sm text-gray-500">
                        v{log.policyVersion}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className="text-sm text-gray-500">
                      {formatDuration(log.duration)}
                    </span>
                    <span className="text-sm text-gray-400">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                    <button
                      onClick={() =>
                        setExpandedLog(expandedLog === log.id ? null : log.id)
                      }
                      className="text-indigo-600 hover:text-indigo-800 text-sm"
                    >
                      {expandedLog === log.id ? t.logs.showLess : t.logs.showMore}
                    </button>
                  </div>
                </div>

                {expandedLog === log.id && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700">{t.logs.input}</h4>
                      <pre className="mt-1 bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                        {JSON.stringify(log.input, null, 2)}
                      </pre>
                    </div>
                    {log.success ? (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700">{t.logs.output}</h4>
                        <pre className="mt-1 bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                          {JSON.stringify(log.output, null, 2)}
                        </pre>
                      </div>
                    ) : (
                      <div>
                        <h4 className="text-sm font-medium text-red-700">{t.logs.error}</h4>
                        <pre className="mt-1 bg-red-50 p-3 rounded text-xs overflow-x-auto text-red-700">
                          {log.error}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-t border-gray-200">
            <div className="text-sm text-gray-700">
              {t.logs.page} {page} {t.logs.of} {totalPages}
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t.logs.previous}
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t.logs.next}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

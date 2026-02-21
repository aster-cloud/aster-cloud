'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/format';

type ExecutionSource = 'WEB' | 'API' | 'CLI' | 'dashboard' | 'api' | 'playground';

interface ExecutionLog {
  id: string;
  success: boolean;
  input: unknown;
  output: unknown;
  error: string | null;
  duration: number;
  source: ExecutionSource;
  policyVersion: number | null;
  createdAt: string;
}

interface Stats {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  successRate: number;
  bySource: Array<{
    source: string;
    count: number;
  }>;
  recentTrend: Array<{
    date: string;
    successCount: number;
    failureCount: number;
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
  initialLogs: ExecutionLog[];
  initialStats: Stats;
  initialTotalPages: number;
}

// Source badge colors and icons
const sourceConfig: Record<ExecutionSource, { bg: string; text: string; ring: string; icon: React.ReactNode }> = {
  WEB: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    ring: 'ring-blue-600/20',
    icon: (
      <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    ),
  },
  API: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    ring: 'ring-purple-600/20',
    icon: (
      <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  CLI: {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    ring: 'ring-gray-600/20',
    icon: (
      <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  // Prisma enum values (lowercase)
  dashboard: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    ring: 'ring-blue-600/20',
    icon: (
      <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
  api: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    ring: 'ring-purple-600/20',
    icon: (
      <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  playground: {
    bg: 'bg-green-50',
    text: 'text-green-700',
    ring: 'ring-green-600/20',
    icon: (
      <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

export function LogsContent({
  policyId,
  policyName,
  translations: t,
  locale,
  initialLogs,
  initialStats,
  initialTotalPages,
}: LogsContentProps) {
  // 使用服务端提供的初始数据，避免客户端首次加载时的空白
  const [logs, setLogs] = useState<ExecutionLog[]>(initialLogs);
  const [stats, setStats] = useState<Stats | null>(initialStats);
  const [loading, setLoading] = useState(false); // 初始数据已有，无需加载状态
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // Filters
  const [successFilter, setSuccessFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // 跟踪是否为首次挂载，避免重复获取服务端已提供的数据
  const isInitialMount = useRef(true);

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

  // fetchStats 保留供手动刷新使用，添加下划线前缀避免 lint 报错
  const _fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/policies/${policyId}/logs?mode=stats&days=30`);
      if (!res.ok) return;

      const data = await res.json();
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, [policyId]);

  // 仅在筛选条件或分页变化时获取数据，首次挂载使用服务端数据
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    fetchLogs();
  }, [fetchLogs]);

  // Stats 已在服务端获取，无需客户端重新获取
  // 如果需要刷新 stats，可以在特定操作后手动调用 fetchStats

  const resetFilters = () => {
    setSuccessFilter('');
    setSourceFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const hasActiveFilters = successFilter || sourceFilter || startDate || endDate;

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

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr, locale);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mb-8">
        <div className="flex items-center">
          <Link
            href={`/${locale}/policies/${policyId}`}
            className="flex items-center justify-center w-10 h-10 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors mr-4"
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
            <p className="mt-1 text-sm text-gray-500">{policyName}</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {/* Total Executions */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 p-6 shadow-lg">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10" />
            <div className="relative">
              <div className="flex items-center">
                <div className="flex-shrink-0 rounded-lg bg-white/20 p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <p className="mt-4 text-sm font-medium text-indigo-100">{t.logs.totalExecutions}</p>
              <p className="mt-1 text-3xl font-bold text-white">{stats.totalExecutions.toLocaleString()}</p>
            </div>
          </div>

          {/* Success Rate */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 shadow-lg">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10" />
            <div className="relative">
              <div className="flex items-center">
                <div className="flex-shrink-0 rounded-lg bg-white/20 p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <p className="mt-4 text-sm font-medium text-emerald-100">{t.logs.successRate}</p>
              <p className="mt-1 text-3xl font-bold text-white">
                {Math.round(stats.successRate)}%
              </p>
              <p className="mt-1 text-xs text-emerald-200">
                {stats.successCount} / {stats.totalExecutions}
              </p>
            </div>
          </div>

          {/* Failed */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500 to-rose-600 p-6 shadow-lg">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10" />
            <div className="relative">
              <div className="flex items-center">
                <div className="flex-shrink-0 rounded-lg bg-white/20 p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
              </div>
              <p className="mt-4 text-sm font-medium text-rose-100">{t.logs.failed}</p>
              <p className="mt-1 text-3xl font-bold text-white">{stats.failureCount.toLocaleString()}</p>
            </div>
          </div>

          {/* Avg Duration */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 p-6 shadow-lg">
            <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-white/10" />
            <div className="relative">
              <div className="flex items-center">
                <div className="flex-shrink-0 rounded-lg bg-white/20 p-3">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <p className="mt-4 text-sm font-medium text-amber-100">{t.logs.avgDuration}</p>
              <p className="mt-1 text-3xl font-bold text-white">{formatDuration(stats.avgDurationMs)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-gray-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900">{t.logs.filter}</h3>
          </div>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
            >
              <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              {t.logs.reset}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Status
            </label>
            <select
              value={successFilter}
              onChange={(e) => {
                setSuccessFilter(e.target.value);
                setPage(1);
              }}
              className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm cursor-pointer"
            >
              <option value="">{t.logs.all}</option>
              <option value="true">{t.logs.success}</option>
              <option value="false">{t.logs.failed}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              {t.logs.source}
            </label>
            <select
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setPage(1);
              }}
              className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm cursor-pointer"
            >
              <option value="">{t.logs.all}</option>
              <option value="WEB">{t.logs.web}</option>
              <option value="API">{t.logs.api}</option>
              <option value="CLI">{t.logs.cli}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              {t.logs.from}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              {t.logs.to}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-gray-900 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-xl bg-red-50 border border-red-200 p-4">
          <div className="flex">
            <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="ml-3 text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      {/* Logs List */}
      <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 mb-4">
              <svg className="animate-spin h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">Loading execution logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
              <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-1">{t.logs.noLogs}</h3>
            <p className="text-sm text-gray-500">Execute the policy to see logs here</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`transition-colors ${expandedLog === log.id ? 'bg-gray-50' : 'hover:bg-gray-50/50'}`}
              >
                {/* Log Header */}
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Status Icon */}
                      <div
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                          log.success
                            ? 'bg-emerald-100 text-emerald-600'
                            : 'bg-red-100 text-red-600'
                        }`}
                      >
                        {log.success ? (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>

                      {/* Status Badge */}
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                          log.success
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                            : 'bg-red-50 text-red-700 ring-red-600/20'
                        }`}
                      >
                        {log.success ? t.logs.success : t.logs.failed}
                      </span>

                      {/* Source Badge */}
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                          sourceConfig[log.source]?.bg || 'bg-gray-100'
                        } ${sourceConfig[log.source]?.text || 'text-gray-700'} ${
                          sourceConfig[log.source]?.ring || 'ring-gray-600/20'
                        }`}
                      >
                        {sourceConfig[log.source]?.icon}
                        {getSourceLabel(log.source)}
                      </span>

                      {/* Version */}
                      {log.policyVersion && (
                        <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                          v{log.policyVersion}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Duration */}
                      <div className="flex items-center text-sm text-gray-500">
                        <svg className="h-4 w-4 mr-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-medium">{formatDuration(log.duration)}</span>
                      </div>

                      {/* Timestamp */}
                      <div className="text-sm text-gray-400" title={new Date(log.createdAt).toLocaleString()}>
                        {formatRelativeTime(log.createdAt)}
                      </div>

                      {/* Expand/Collapse Button */}
                      <button
                        onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                        className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                          expandedLog === log.id
                            ? 'bg-indigo-100 text-indigo-700'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {expandedLog === log.id ? (
                          <>
                            <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                            {t.logs.showLess}
                          </>
                        ) : (
                          <>
                            <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            {t.logs.showMore}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedLog === log.id && (
                  <div className="px-4 pb-4">
                    <div className="ml-11 space-y-4">
                      {/* Input */}
                      <div className="rounded-lg border border-gray-200 overflow-hidden">
                        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center">
                            <svg className="h-4 w-4 mr-1.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                            </svg>
                            {t.logs.input}
                          </h4>
                        </div>
                        <pre className="bg-white p-4 text-xs overflow-x-auto font-mono text-gray-700 max-h-48">
                          {JSON.stringify(log.input, null, 2)}
                        </pre>
                      </div>

                      {/* Output or Error */}
                      {log.success ? (
                        <div className="rounded-lg border border-emerald-200 overflow-hidden">
                          <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-200">
                            <h4 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide flex items-center">
                              <svg className="h-4 w-4 mr-1.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                              </svg>
                              {t.logs.output}
                            </h4>
                          </div>
                          <pre className="bg-white p-4 text-xs overflow-x-auto font-mono text-gray-700 max-h-48">
                            {JSON.stringify(log.output, null, 2)}
                          </pre>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-red-200 overflow-hidden">
                          <div className="bg-red-50 px-4 py-2 border-b border-red-200">
                            <h4 className="text-xs font-semibold text-red-700 uppercase tracking-wide flex items-center">
                              <svg className="h-4 w-4 mr-1.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {t.logs.error}
                            </h4>
                          </div>
                          <pre className="bg-white p-4 text-xs overflow-x-auto font-mono text-red-600 max-h-48">
                            {log.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-gray-50 px-4 py-4 flex items-center justify-between border-t border-gray-200">
            <div className="flex items-center text-sm text-gray-500">
              <span className="font-medium text-gray-900">{t.logs.page} {page}</span>
              <span className="mx-1">{t.logs.of}</span>
              <span className="font-medium text-gray-900">{totalPages}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="inline-flex items-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t.logs.previous}
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="inline-flex items-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t.logs.next}
                <svg className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

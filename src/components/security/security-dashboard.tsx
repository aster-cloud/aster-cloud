'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { SecurityEventType, EventSeverity } from '@prisma/client';

interface SecurityStats {
  total: number;
  bySeverity: Record<EventSeverity, number>;
  byType: Record<string, number>;
  errorRate: number;
  period: {
    startDate: string;
    endDate: string;
  };
}

interface SecurityEvent {
  id: string;
  eventType: SecurityEventType;
  severity: EventSeverity;
  policyId: string | null;
  userId: string | null;
  ipAddress: string | null;
  requestId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

interface SecurityDashboardProps {
  policyId?: string;
}

const SEVERITY_CONFIG: Record<EventSeverity, { label: string; color: string; bgColor: string }> = {
  INFO: { label: '信息', color: 'text-blue-700', bgColor: 'bg-blue-100' },
  WARNING: { label: '警告', color: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  ERROR: { label: '错误', color: 'text-red-700', bgColor: 'bg-red-100' },
  CRITICAL: { label: '严重', color: 'text-red-900', bgColor: 'bg-red-200' },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  SIGNATURE_INVALID: '签名无效',
  NONCE_REUSED: 'Nonce 重放',
  TIMESTAMP_EXPIRED: '时间戳过期',
  HASH_MISMATCH: '哈希不匹配',
  UNAUTHORIZED_APPROVAL: '未授权审批',
  SELF_APPROVAL_ATTEMPT: '自审批尝试',
  POLICY_EXECUTED: '策略执行',
  APPROVAL_DECISION: '审批决策',
  VERSION_CREATED: '版本创建',
  VERSION_NOT_FOUND: '版本不存在',
  DEPRECATED_VERSION_EXECUTED: '执行已废弃版本',
  VERSION_SET_DEFAULT: '设置默认版本',
  VERSION_DEPRECATED: '版本被废弃',
  VERSION_ARCHIVED: '版本被归档',
};

type TimeRange = '1h' | '24h' | '7d' | '30d';

export function SecurityDashboard({ policyId }: SecurityDashboardProps) {
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [selectedSeverity, setSelectedSeverity] = useState<EventSeverity | 'ALL'>('ALL');

  const getTimeRangeParams = useCallback((range: TimeRange) => {
    const end = new Date();
    let start: Date;

    switch (range) {
      case '1h':
        start = new Date(end.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { startDate, endDate } = getTimeRangeParams(timeRange);
      const params = new URLSearchParams({
        startDate,
        endDate,
        ...(policyId && { policyId }),
      });

      const [statsRes, eventsRes] = await Promise.all([
        fetch(`/api/v1/security/stats?${params}`),
        fetch(`/api/v1/security/events?${params}&limit=20`),
      ]);

      if (!statsRes.ok || !eventsRes.ok) {
        throw new Error('获取安全数据失败');
      }

      const [statsData, eventsData] = await Promise.all([
        statsRes.json(),
        eventsRes.json(),
      ]);

      setStats(statsData);
      setEvents(eventsData.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [timeRange, policyId, getTimeRangeParams]);

  useEffect(() => {
    fetchData();
    // 自动刷新（每 30 秒）
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredEvents = useMemo(() => {
    if (selectedSeverity === 'ALL') return events;
    return events.filter((e) => e.severity === selectedSeverity);
  }, [events, selectedSeverity]);

  if (loading && !stats) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 dark:text-red-400">{error}</p>
        <button
          onClick={fetchData}
          className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          安全监控
        </h2>
        <div className="flex items-center gap-4">
          {/* Time Range Selector */}
          <div className="flex rounded-md shadow-sm">
            {(['1h', '24h', '7d', '30d'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 text-sm font-medium first:rounded-l-md last:rounded-r-md border ${
                  timeRange === range
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {range === '1h' ? '1小时' : range === '24h' ? '24小时' : range === '7d' ? '7天' : '30天'}
              </button>
            ))}
          </div>
          {/* Refresh Button */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg
              className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Events */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">总事件数</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900 dark:text-white">
              {stats.total.toLocaleString()}
            </dd>
          </div>

          {/* Error Rate */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">错误率</dt>
            <dd className={`mt-1 text-3xl font-semibold ${
              stats.errorRate > 0.1 ? 'text-red-600' : stats.errorRate > 0.05 ? 'text-yellow-600' : 'text-green-600'
            }`}>
              {(stats.errorRate * 100).toFixed(1)}%
            </dd>
          </div>

          {/* Warnings */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">警告</dt>
            <dd className="mt-1 text-3xl font-semibold text-yellow-600">
              {stats.bySeverity.WARNING.toLocaleString()}
            </dd>
          </div>

          {/* Errors + Critical */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">错误/严重</dt>
            <dd className="mt-1 text-3xl font-semibold text-red-600">
              {(stats.bySeverity.ERROR + stats.bySeverity.CRITICAL).toLocaleString()}
            </dd>
          </div>
        </div>
      )}

      {/* Event Type Breakdown */}
      {stats && Object.keys(stats.byType).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">事件类型分布</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(stats.byType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded"
                >
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                    {EVENT_TYPE_LABELS[type] || type}
                  </span>
                  <span className="ml-2 text-sm font-medium text-gray-900 dark:text-white">
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent Events */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">最近事件</h3>
          {/* Severity Filter */}
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value as EventSeverity | 'ALL')}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="ALL">全部级别</option>
            <option value="INFO">信息</option>
            <option value="WARNING">警告</option>
            <option value="ERROR">错误</option>
            <option value="CRITICAL">严重</option>
          </select>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
          {filteredEvents.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              暂无事件记录
            </div>
          ) : (
            filteredEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          SEVERITY_CONFIG[event.severity].bgColor
                        } ${SEVERITY_CONFIG[event.severity].color}`}
                      >
                        {SEVERITY_CONFIG[event.severity].label}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {event.policyId && (
                        <span className="mr-3">策略: {event.policyId.slice(0, 8)}...</span>
                      )}
                      {event.ipAddress && (
                        <span className="mr-3">IP: {event.ipAddress}</span>
                      )}
                      {event.requestId && (
                        <span>请求ID: {event.requestId.slice(0, 8)}...</span>
                      )}
                    </div>
                    {/* Event Details */}
                    {Object.keys(event.details).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-indigo-600 dark:text-indigo-400 cursor-pointer">
                          查看详情
                        </summary>
                        <pre className="mt-1 text-xs bg-gray-100 dark:bg-gray-900 p-2 rounded overflow-x-auto">
                          {JSON.stringify(event.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                  <div className="ml-4 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(event.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

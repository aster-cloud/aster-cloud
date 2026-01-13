'use client';

import { useState, useCallback } from 'react';
import { Link } from '@/i18n/navigation';
import { isUnlimited } from '@/lib/plans';

interface DashboardStats {
  plan: string;
  trialDaysLeft: number | null;
  usage: {
    executions: number;
    executionsLimit: number;
    policies: number;
    policiesLimit: number;
    piiScans: number;
    complianceReports: number;
    apiCalls: number;
    apiCallsLimit: number;
  };
  features: {
    piiDetection: string;
    sharing: boolean;
    complianceReports: boolean;
    apiAccess: boolean;
    teamFeatures: boolean;
  };
}

interface Policy {
  id: string;
  name: string;
  description: string | null;
  piiFields: string[] | null;
  updatedAt: string;
  _count: {
    executions: number;
  };
  isDeleted?: boolean;
}

interface Translations {
  welcomeBack: string;
  newPolicy: string;
  trialActive: string;
  trialDaysLeft: string;
  upgradeNow: string;
  toKeepProFeatures: string;
  planActive: string;
  stats: {
    totalPolicies: string;
    executionsThisMonth: string;
    apiCalls: string;
    piiFieldsDetected: string;
    limitTemplate: string;
    upgradeForApi: string;
    reviewRecommended: string;
  };
  quickActions: {
    title: string;
    createPolicy: string;
    createPolicyDesc: string;
    generateReport: string;
    generateReportDesc: string;
    apiKeys: string;
    apiKeysDesc: string;
  };
  recentPolicies: {
    title: string;
    viewAll: string;
    noPolicies: string;
    createFirst: string;
    noDescription: string;
    runsTemplate: string;
    deleted: string;
    restoreHint: string;
  };
}

// 简单模板插值
function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

interface DashboardContentProps {
  stats: DashboardStats;
  policies: Policy[];
  totalPiiFields: number;
  translations: Translations;
}

export function DashboardContent({
  stats,
  policies,
  totalPiiFields,
  translations: t,
}: DashboardContentProps) {
  // 跟踪已删除策略的点击次数
  const [deletedClickCount, setDeletedClickCount] = useState<Record<string, number>>({});
  const [showRestoreHint, setShowRestoreHint] = useState(false);

  // 处理已删除策略的点击
  const handleDeletedPolicyClick = useCallback((policyId: string) => {
    setDeletedClickCount((prev) => {
      const newCount = (prev[policyId] || 0) + 1;
      if (newCount >= 2) {
        setShowRestoreHint(true);
        // 3秒后自动隐藏提示
        setTimeout(() => setShowRestoreHint(false), 3000);
      }
      return { ...prev, [policyId]: newCount };
    });
  }, []);

  return (
    <div>
      {/* 恢复提示 Toast */}
      {showRestoreHint && (
        <div className="fixed top-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-3 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 shadow-lg">
            <svg className="h-5 w-5 text-yellow-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-yellow-800">{t.recentPolicies.restoreHint}</p>
            <button
              onClick={() => setShowRestoreHint(false)}
              className="ml-2 text-yellow-600 hover:text-yellow-800"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="md:flex md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            {t.welcomeBack}
          </h2>
        </div>
        <div className="mt-4 flex md:ml-4 md:mt-0">
          <Link
            href="/policies/new"
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            {t.newPolicy}
          </Link>
        </div>
      </div>

      {/* Trial Banner */}
      {stats.plan === 'trial' && stats.trialDaysLeft !== null && (
        <div className="mt-6 rounded-lg bg-indigo-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-indigo-800">{t.trialActive}</h3>
              <p className="mt-1 text-sm text-indigo-700">
                {t.trialDaysLeft}{' '}
                <Link href="/billing" className="font-medium underline">
                  {t.upgradeNow}
                </Link>{' '}
                {t.toKeepProFeatures}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Plan Badge for non-trial users */}
      {stats.plan && stats.plan !== 'trial' && stats.plan !== 'free' && (
        <div className="mt-6 rounded-lg bg-green-50 p-4">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            <span className="ml-2 text-sm font-medium text-green-800 capitalize">
              {t.planActive}
            </span>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* 策略总数 */}
        <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow sm:p-6">
          <dt className="truncate text-sm font-medium text-gray-500">{t.stats.totalPolicies}</dt>
          <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
            {stats.usage.policies || 0}
          </dd>
          {stats.usage.policiesLimit !== undefined && !isUnlimited(stats.usage.policiesLimit) && (
            <div className="mt-2">
              <div className="h-2 w-full bg-gray-200 rounded-full">
                <div
                  className="h-2 bg-indigo-600 rounded-full"
                  style={{
                    width: `${Math.min(
                      ((stats.usage.policies || 0) / (stats.usage.policiesLimit || 1)) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {formatTemplate(t.stats.limitTemplate, { count: stats.usage.policiesLimit })}
              </p>
            </div>
          )}
        </div>

        {/* 本月执行次数 */}
        <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow sm:p-6">
          <dt className="truncate text-sm font-medium text-gray-500">{t.stats.executionsThisMonth}</dt>
          <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
            {stats.usage.executions || 0}
          </dd>
          {stats.usage.executionsLimit !== undefined &&
            !isUnlimited(stats.usage.executionsLimit) && (
            <div className="mt-2">
              <div className="h-2 w-full bg-gray-200 rounded-full">
                <div
                  className="h-2 bg-indigo-600 rounded-full"
                  style={{
                    width: `${Math.min(
                      ((stats.usage.executions || 0) / (stats.usage.executionsLimit || 1)) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {formatTemplate(t.stats.limitTemplate, { count: stats.usage.executionsLimit })}
              </p>
            </div>
          )}
        </div>

        {/* API 调用 */}
        <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow sm:p-6">
          <dt className="truncate text-sm font-medium text-gray-500">{t.stats.apiCalls}</dt>
          <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
            {stats.usage.apiCalls || 0}
          </dd>
          {!stats.features.apiAccess ? (
            <Link href="/billing" className="mt-1 text-xs text-indigo-600">
              {t.stats.upgradeForApi}
            </Link>
          ) : stats.usage.apiCallsLimit !== undefined && !isUnlimited(stats.usage.apiCallsLimit) && (
            <div className="mt-2">
              <div className="h-2 w-full bg-gray-200 rounded-full">
                <div
                  className="h-2 bg-indigo-600 rounded-full"
                  style={{
                    width: `${Math.min(
                      ((stats.usage.apiCalls || 0) / (stats.usage.apiCallsLimit || 1)) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {formatTemplate(t.stats.limitTemplate, { count: stats.usage.apiCallsLimit })}
              </p>
            </div>
          )}
        </div>

        {/* PII 字段检测 */}
        <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow sm:p-6">
          <dt className="truncate text-sm font-medium text-gray-500">{t.stats.piiFieldsDetected}</dt>
          <dd className="mt-1 text-3xl font-semibold tracking-tight text-gray-900">
            {totalPiiFields}
          </dd>
          {totalPiiFields > 0 && (
            <p className="mt-1 text-xs text-yellow-600">
              {t.stats.reviewRecommended}
            </p>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <h3 className="text-lg font-medium leading-6 text-gray-900">{t.quickActions.title}</h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link
            href="/policies/new"
            className="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div className="flex-shrink-0 p-3 bg-indigo-100 rounded-lg">
              <svg className="h-6 w-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-900">{t.quickActions.createPolicy}</p>
              <p className="text-xs text-gray-500">{t.quickActions.createPolicyDesc}</p>
            </div>
          </Link>

          <Link
            href="/reports"
            className="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div className="flex-shrink-0 p-3 bg-green-100 rounded-lg">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-900">{t.quickActions.generateReport}</p>
              <p className="text-xs text-gray-500">{t.quickActions.generateReportDesc}</p>
            </div>
          </Link>

          <Link
            href="/settings/api-keys"
            className="flex items-center p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div className="flex-shrink-0 p-3 bg-purple-100 rounded-lg">
              <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-900">{t.quickActions.apiKeys}</p>
              <p className="text-xs text-gray-500">{t.quickActions.apiKeysDesc}</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Recent Policies */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium leading-6 text-gray-900">{t.recentPolicies.title}</h3>
          <Link href="/policies" className="text-sm text-indigo-600 hover:text-indigo-500">
            {t.recentPolicies.viewAll}
          </Link>
        </div>
        <div className="mt-4 overflow-hidden bg-white shadow sm:rounded-md">
          {policies.length === 0 ? (
            <div className="px-4 py-12 text-center text-gray-500">
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="mt-2">{t.recentPolicies.noPolicies}</p>
              <p className="mt-2">
                <Link href="/policies/new" className="text-indigo-600 hover:text-indigo-500">
                  {t.recentPolicies.createFirst}
                </Link>
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-200">
              {policies.map((policy) => (
                <li key={policy.id}>
                  {policy.isDeleted ? (
                    // 已删除的策略：不可点击，仅显示
                    <div
                      className="block cursor-not-allowed"
                      onClick={() => handleDeletedPolicyClick(policy.id)}
                    >
                      <div className="px-4 py-4 sm:px-6">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate text-gray-400 line-through">
                            {policy.name}
                          </p>
                          <div className="ml-2 flex-shrink-0 flex gap-2">
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                              {t.recentPolicies.deleted}
                            </span>
                            {policy.piiFields && policy.piiFields.length > 0 && (
                              <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                                {policy.piiFields.length} PII
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex justify-between">
                          <p className="text-sm text-gray-500 truncate">
                            {policy.description || t.recentPolicies.noDescription}
                          </p>
                          <p className="text-sm text-gray-400">
                            {formatTemplate(t.recentPolicies.runsTemplate, { count: policy._count.executions })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // 正常策略：可点击跳转
                    <Link
                      href={`/policies/${policy.id}`}
                      className="block hover:bg-gray-50"
                    >
                      <div className="px-4 py-4 sm:px-6">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate text-indigo-600">
                            {policy.name}
                          </p>
                          <div className="ml-2 flex-shrink-0 flex gap-2">
                            {policy.piiFields && policy.piiFields.length > 0 && (
                              <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                                {policy.piiFields.length} PII
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex justify-between">
                          <p className="text-sm text-gray-500 truncate">
                            {policy.description || t.recentPolicies.noDescription}
                          </p>
                          <p className="text-sm text-gray-400">
                            {formatTemplate(t.recentPolicies.runsTemplate, { count: policy._count.executions })}
                          </p>
                        </div>
                      </div>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Policy {
  id: string;
  name: string;
  description: string | null;
  content: string;
  isPublic: boolean;
  piiFields: string[] | null;
  createdAt: string;
  updatedAt: string;
  isFrozen: boolean;
  _count: {
    executions: number;
  };
}

interface FreezeInfo {
  limit: number;
  total: number;
  frozenCount: number;
}

interface Translations {
  title: string;
  subtitle: string;
  newPolicy: string;
  trash: string;
  failedToLoad: string;
  failedToDelete: string;
  confirmDelete: string;
  freeze: {
    title: string;
    messageTemplate: string;
    upgradeLink: string;
    badge: string;
    cannotExecute: string;
    cannotEdit: string;
  };
  noPolicies: string;
  getStarted: string;
  piiFieldsTemplate: string;
  public: string;
  executionsTemplate: string;
  executeAction: string;
  edit: string;
  delete: string;
  updatedTemplate: string;
}

// 简单模板插值
function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

interface PoliciesContentProps {
  initialPolicies: Policy[];
  freezeInfo: FreezeInfo;
  translations: Translations;
  locale: string;
}

export function PoliciesContent({
  initialPolicies,
  freezeInfo: initialFreezeInfo,
  translations: t,
  locale,
}: PoliciesContentProps) {
  const [policies, setPolicies] = useState<Policy[]>(initialPolicies);
  const [freezeInfo, setFreezeInfo] = useState<FreezeInfo>(initialFreezeInfo);
  const [error, setError] = useState('');

  // 重新获取策略列表和冻结状态
  const refreshPolicies = async () => {
    try {
      const res = await fetch('/api/policies');
      if (!res.ok) return;
      const data = await res.json();
      setPolicies(data.policies || []);
      if (data.freezeInfo) {
        setFreezeInfo(data.freezeInfo);
      }
    } catch (err) {
      console.error('Failed to refresh policies:', err);
    }
  };

  const deletePolicy = async (id: string) => {
    if (!confirm(t.confirmDelete)) return;

    try {
      const res = await fetch(`/api/policies/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete policy');
      // 删除后重新获取列表以更新冻结状态
      await refreshPolicies();
    } catch (err) {
      setError(t.failedToDelete);
      console.error(err);
    }
  };

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{t.subtitle}</p>
        </div>
        <div className="mt-4 sm:mt-0 flex space-x-3">
          <Link
            href={`/${locale}/policies/trash`}
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            <svg className="-ml-0.5 mr-1.5 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {t.trash}
          </Link>
          <Link
            href={`/${locale}/policies/new`}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            {t.newPolicy}
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Freeze Warning Banner */}
      {freezeInfo.frozenCount > 0 && (
        <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-amber-800">{t.freeze.title}</h3>
              <p className="mt-1 text-sm text-amber-700">
                {formatTemplate(t.freeze.messageTemplate, { frozen: freezeInfo.frozenCount, limit: freezeInfo.limit, total: freezeInfo.total })}
              </p>
              <div className="mt-2">
                <Link
                  href={`/${locale}/billing`}
                  className="text-sm font-medium text-amber-800 underline hover:text-amber-900"
                >
                  {t.freeze.upgradeLink}
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {policies.length === 0 ? (
        <div className="mt-8 text-center">
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
          <h3 className="mt-2 text-sm font-semibold text-gray-900">{t.noPolicies}</h3>
          <p className="mt-1 text-sm text-gray-500">{t.getStarted}</p>
          <div className="mt-6">
            <Link
              href={`/${locale}/policies/new`}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              {t.newPolicy}
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden bg-white shadow sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {policies.map((policy) => (
              <li key={policy.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <Link href={`/${locale}/policies/${policy.id}`} className="block">
                        <p className="text-sm font-medium text-indigo-600 truncate hover:underline">
                          {policy.name}
                        </p>
                        {policy.description && (
                          <p className="mt-1 text-sm text-gray-500 truncate">
                            {policy.description}
                          </p>
                        )}
                      </Link>
                    </div>
                    <div className="ml-4 flex items-center space-x-4">
                      {/* Frozen Badge */}
                      {policy.isFrozen && (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                          <svg className="mr-1 h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06a.75.75 0 01-1.06 1.061l-1.061-1.06a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.061a.75.75 0 11-1.061-1.06l1.06-1.06a.75.75 0 011.06 0zM10 14a4 4 0 100-8 4 4 0 000 8zm-8.25-3.25a.75.75 0 000 1.5h1.5a.75.75 0 000-1.5h-1.5zm14.5 0a.75.75 0 000 1.5h1.5a.75.75 0 000-1.5h-1.5zM5.05 16.95a.75.75 0 001.06 0l1.06-1.06a.75.75 0 00-1.06-1.061l-1.06 1.06a.75.75 0 000 1.061zm9.9 0a.75.75 0 010-1.06l1.06-1.061a.75.75 0 111.061 1.06l-1.06 1.06a.75.75 0 01-1.061 0z" clipRule="evenodd" />
                          </svg>
                          {t.freeze.badge}
                        </span>
                      )}

                      {/* PII Badge */}
                      {policy.piiFields && policy.piiFields.length > 0 && (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                          {formatTemplate(t.piiFieldsTemplate, { count: policy.piiFields.length })}
                        </span>
                      )}

                      {/* Public Badge */}
                      {policy.isPublic && (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                          {t.public}
                        </span>
                      )}

                      {/* Execution count */}
                      <span className="text-sm text-gray-500">
                        {formatTemplate(t.executionsTemplate, { count: policy._count.executions })}
                      </span>

                      {/* Actions */}
                      <div className="flex items-center space-x-2">
                        {policy.isFrozen ? (
                          <span className="text-gray-400 text-sm cursor-not-allowed" title={t.freeze.cannotExecute}>
                            {t.executeAction}
                          </span>
                        ) : (
                          <Link
                            href={`/${locale}/policies/${policy.id}/execute`}
                            className="text-indigo-600 hover:text-indigo-900 text-sm"
                          >
                            {t.executeAction}
                          </Link>
                        )}
                        {policy.isFrozen ? (
                          <span className="text-gray-400 text-sm cursor-not-allowed" title={t.freeze.cannotEdit}>
                            {t.edit}
                          </span>
                        ) : (
                          <Link
                            href={`/${locale}/policies/${policy.id}/edit`}
                            className="text-gray-600 hover:text-gray-900 text-sm"
                          >
                            {t.edit}
                          </Link>
                        )}
                        <button
                          onClick={() => deletePolicy(policy.id)}
                          className="text-red-600 hover:text-red-900 text-sm"
                        >
                          {t.delete}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-xs text-gray-400">
                      {formatTemplate(t.updatedTemplate, { date: new Date(policy.updatedAt).toLocaleDateString() })}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

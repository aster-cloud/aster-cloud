'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

interface Policy {
  id: string;
  name: string;
  description: string | null;
  version: number;
  piiFields: string[] | null;
  createdBy: {
    id: string;
    name: string | null;
  } | null;
  executionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Team {
  id: string;
  name: string;
  slug: string;
}

export default function TeamPoliciesPage() {
  const t = useTranslations('teams');
  const tPolicies = useTranslations('policies');
  const params = useParams();
  const teamId = params.teamId as string;

  const [team, setTeam] = useState<Team | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [userRole, setUserRole] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 创建策略表单
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPolicy, setNewPolicy] = useState({ name: '', content: '', description: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    fetchData();
  }, [teamId]);

  const fetchData = async () => {
    try {
      const [teamRes, policiesRes] = await Promise.all([
        fetch(`/api/teams/${teamId}`),
        fetch(`/api/teams/${teamId}/policies`),
      ]);

      if (!teamRes.ok) {
        const data = await teamRes.json();
        throw new Error(data.error || 'Failed to fetch team');
      }

      const teamData = await teamRes.json();
      setTeam(teamData.team);
      setUserRole(teamData.role);

      if (policiesRes.ok) {
        const policiesData = await policiesRes.json();
        setPolicies(policiesData.policies);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToLoad'));
    } finally {
      setIsLoading(false);
    }
  };

  const canCreatePolicy = userRole === 'owner' || userRole === 'admin' || userRole === 'member';

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError('');

    try {
      const res = await fetch(`/api/teams/${teamId}/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPolicy),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create policy');
      }

      // 刷新策略列表
      await fetchData();
      setShowCreateForm(false);
      setNewPolicy({ name: '', content: '', description: '' });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('policies.createFailed'));
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error || t('teamNotFound')}</p>
        <Link href="/teams" className="mt-4 text-indigo-600 hover:text-indigo-700">
          {t('backToTeams')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* 页头 */}
      <div className="mb-6">
        <Link
          href={`/teams/${teamId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('backToTeam')}
        </Link>
      </div>

      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('policies.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{team.name}</p>
        </div>
        {canCreatePolicy && (
          <div className="mt-4 sm:mt-0">
            <button
              onClick={() => setShowCreateForm(true)}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              {t('policies.newPolicy')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* 创建策略模态框 */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">{t('policies.createTitle')}</h3>
            </div>
            <form onSubmit={handleCreatePolicy} className="px-6 py-4 space-y-4">
              {createError && (
                <div className="rounded-md bg-red-50 p-3">
                  <p className="text-sm text-red-700">{createError}</p>
                </div>
              )}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  {t('policies.nameLabel')}
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={newPolicy.name}
                  onChange={(e) => setNewPolicy((prev) => ({ ...prev, name: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder={t('policies.namePlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                  {t('policies.descriptionLabel')}
                </label>
                <input
                  type="text"
                  id="description"
                  name="description"
                  value={newPolicy.description}
                  onChange={(e) => setNewPolicy((prev) => ({ ...prev, description: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder={t('policies.descriptionPlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="content" className="block text-sm font-medium text-gray-700">
                  {t('policies.contentLabel')}
                </label>
                <textarea
                  id="content"
                  name="content"
                  required
                  rows={10}
                  value={newPolicy.content}
                  onChange={(e) => setNewPolicy((prev) => ({ ...prev, content: e.target.value }))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono"
                  placeholder={t('policies.contentPlaceholder')}
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isCreating ? t('creating') : t('policies.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 策略列表 */}
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
          <h3 className="mt-2 text-sm font-semibold text-gray-900">{t('policies.noPolicies')}</h3>
          <p className="mt-1 text-sm text-gray-500">{t('policies.getStarted')}</p>
          {canCreatePolicy && (
            <div className="mt-6">
              <button
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
              >
                <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                </svg>
                {t('policies.newPolicy')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-8 overflow-hidden bg-white shadow sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {policies.map((policy) => (
              <li key={policy.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <Link href={`/policies/${policy.id}`} className="block">
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
                      {/* PII 标签 */}
                      {policy.piiFields && policy.piiFields.length > 0 && (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                          {tPolicies('piiFields', { count: policy.piiFields.length })}
                        </span>
                      )}

                      {/* 执行次数 */}
                      <span className="text-sm text-gray-500">
                        {t('executions', { count: policy.executionCount })}
                      </span>

                      {/* 版本 */}
                      <span className="text-xs text-gray-400">v{policy.version}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-xs text-gray-400">
                      {policy.createdBy && (
                        <span>
                          {t('policies.createdBy', { name: policy.createdBy.name || 'Unknown' })}
                          {' · '}
                        </span>
                      )}
                      {t('policies.updatedAt', {
                        date: new Date(policy.updatedAt).toLocaleDateString(),
                      })}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Link
                        href={`/policies/${policy.id}/execute`}
                        className="text-indigo-600 hover:text-indigo-900 text-sm"
                      >
                        {tPolicies('executeAction')}
                      </Link>
                      <Link
                        href={`/policies/${policy.id}`}
                        className="text-gray-600 hover:text-gray-900 text-sm"
                      >
                        {t('viewDetails')}
                      </Link>
                    </div>
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

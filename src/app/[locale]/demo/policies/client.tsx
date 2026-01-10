'use client';

import { useEffect, useState, useCallback } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useDemoSession } from '@/components/demo';
import { fetchDemoPolicies, deleteDemoPolicy } from '@/lib/demo-api';

interface DemoPolicy {
  id: string;
  name: string;
  description: string | null;
  version: number;
  piiFields: string[] | null;
  updatedAt: string;
  _count: {
    executions: number;
  };
}

interface DemoPoliciesClientProps {
  translations: {
    title: string;
    subtitle: string;
    newPolicy: string;
    noPolicies: string;
    createFirst: string;
    loadExamples: string;
    piiFields: string;
    executions: string;
    updated: string;
    policiesCount: string;
    actions: {
      execute: string;
      edit: string;
      delete: string;
    };
    confirmDelete: string;
    limitReached: string;
  };
}

export function DemoPoliciesClient({ translations: t }: DemoPoliciesClientProps) {
  const router = useRouter();
  const { session, limits, refreshSession } = useDemoSession();
  const [policies, setPolicies] = useState<DemoPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadPolicies = useCallback(async () => {
    try {
      const response = await fetchDemoPolicies();
      if (response.success && response.data) {
        // 添加 version 字段
        const policiesWithVersion = response.data.policies.map(p => ({
          ...p,
          version: p.version || 1,
        }));
        setPolicies(policiesWithVersion as DemoPolicy[]);
      }
    } catch (err) {
      console.error('Failed to load policies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      loadPolicies();
    }
  }, [session, loadPolicies]);

  const handleDelete = async (policyId: string) => {
    if (!confirm(t.confirmDelete)) return;

    setDeleting(policyId);
    try {
      const response = await deleteDemoPolicy(policyId);
      if (response.success) {
        setPolicies((prev) => prev.filter((p) => p.id !== policyId));
        refreshSession();
      }
    } catch (err) {
      console.error('Failed to delete policy:', err);
    } finally {
      setDeleting(null);
    }
  };

  const canCreateMore = limits
    ? limits.policies.current < limits.policies.max
    : true;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-200 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="text-gray-600 mt-1">{t.subtitle}</p>
        </div>
        <div className="flex items-center space-x-3">
          {canCreateMore ? (
            <Link
              href="/demo/policies/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
            >
              {t.newPolicy}
            </Link>
          ) : (
            <span className="text-sm text-amber-600">{t.limitReached}</span>
          )}
        </div>
      </div>

      {/* Policy Limit Indicator */}
      {limits && (
        <div className="bg-gray-50 rounded-lg px-4 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">
              {t.policiesCount
                .replace('{current}', String(limits.policies.current))
                .replace('{max}', String(limits.policies.max))}
            </span>
            <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full"
                style={{
                  width: `${(limits.policies.current / limits.policies.max) * 100}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Policies List */}
      {policies.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500 mb-4">{t.noPolicies}</p>
          <div className="flex justify-center gap-4">
            <Link
              href="/demo/policies/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
            >
              {t.createFirst}
            </Link>
            <Link
              href="/demo/policies/new?example=loan"
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              {t.loadExamples}
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
          {policies.map((policy) => (
            <div key={policy.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/demo/policies/${policy.id}`}
                    className="text-base font-medium text-gray-900 hover:text-indigo-600"
                  >
                    {policy.name}
                  </Link>
                  {policy.description && (
                    <p className="text-sm text-gray-500 mt-1 truncate">
                      {policy.description}
                    </p>
                  )}
                  <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                    <span>v{policy.version}</span>
                    <span>
                      {t.executions.replace(
                        '{count}',
                        String(policy._count.executions)
                      )}
                    </span>
                    {policy.piiFields && policy.piiFields.length > 0 && (
                      <span className="text-amber-600">
                        🔒{' '}
                        {t.piiFields.replace(
                          '{count}',
                          String(policy.piiFields.length)
                        )}
                      </span>
                    )}
                    <span>
                      {t.updated.replace(
                        '{date}',
                        new Date(policy.updatedAt).toLocaleDateString()
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  <Link
                    href={`/demo/execute?policy=${policy.id}`}
                    className="px-3 py-1 text-sm text-indigo-600 hover:bg-indigo-50 rounded"
                  >
                    {t.actions.execute}
                  </Link>
                  <Link
                    href={`/demo/policies/${policy.id}/edit`}
                    className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                  >
                    {t.actions.edit}
                  </Link>
                  <button
                    onClick={() => handleDelete(policy.id)}
                    disabled={deleting === policy.id}
                    className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                  >
                    {deleting === policy.id ? '...' : t.actions.delete}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

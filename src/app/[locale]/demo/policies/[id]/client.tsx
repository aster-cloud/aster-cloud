'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useDemoSession } from '@/components/demo';
import { fetchDemoPolicy, deleteDemoPolicy } from '@/lib/demo-api';

interface DemoPolicy {
  id: string;
  name: string;
  description: string | null;
  content: string;
  version: number;
  piiFields: string[] | null;
  createdAt: string;
  updatedAt: string;
  versions: Array<{
    id: string;
    version: number;
    comment: string | null;
    createdAt: string;
  }>;
  _count: {
    executions: number;
  };
}

interface DemoPolicyDetailClientProps {
  policyId: string;
  translations: {
    backToList: string;
    version: string;
    executions: string;
    piiFields: string;
    piiWarning: string;
    content: string;
    versionHistory: string;
    execute: string;
    edit: string;
    delete: string;
    confirmDelete: string;
    notFound: string;
    loading: string;
  };
}

export function DemoPolicyDetailClient({
  policyId,
  translations: t,
}: DemoPolicyDetailClientProps) {
  const router = useRouter();
  const { session, refreshSession } = useDemoSession();
  const [policy, setPolicy] = useState<DemoPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPolicy = useCallback(async () => {
    try {
      const response = await fetchDemoPolicy(policyId);
      if (response.success && response.data) {
        setPolicy(response.data);
      } else {
        setError(response.error || t.notFound);
      }
    } catch (err) {
      setError(t.notFound);
    } finally {
      setLoading(false);
    }
  }, [policyId, t.notFound]);

  useEffect(() => {
    if (session) {
      loadPolicy();
    }
  }, [session, loadPolicy]);

  const handleDelete = async () => {
    if (!confirm(t.confirmDelete)) return;

    setDeleting(true);
    try {
      const response = await deleteDemoPolicy(policyId);
      if (response.success) {
        refreshSession();
        router.push('/demo/policies');
      }
    } catch (err) {
      console.error('Failed to delete policy:', err);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 bg-gray-200 animate-pulse rounded" />
        <div className="h-48 bg-gray-200 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">{error || t.notFound}</p>
        <Link
          href="/demo/policies"
          className="text-indigo-600 hover:text-indigo-800"
        >
          {t.backToList}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/demo/policies"
            className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block"
          >
            ← {t.backToList}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{policy.name}</h1>
          {policy.description && (
            <p className="text-gray-600 mt-1">{policy.description}</p>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <Link
            href={`/demo/execute?policy=${policy.id}`}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            {t.execute}
          </Link>
          <Link
            href={`/demo/policies/${policy.id}/edit`}
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            {t.edit}
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? '...' : t.delete}
          </button>
        </div>
      </div>

      {/* Meta Info */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t.version}</p>
          <p className="text-xl font-semibold text-gray-900">v{policy.version}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t.executions}</p>
          <p className="text-xl font-semibold text-gray-900">
            {policy._count.executions}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-sm text-gray-500">{t.piiFields}</p>
          <p className="text-xl font-semibold text-gray-900">
            {policy.piiFields?.length || 0}
          </p>
        </div>
      </div>

      {/* PII Warning */}
      {policy.piiFields && policy.piiFields.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-amber-800 font-medium mb-2">{t.piiWarning}</h3>
          <div className="flex flex-wrap gap-2">
            {policy.piiFields.map((field, i) => (
              <span
                key={i}
                className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-sm"
              >
                {field}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.content}</h2>
        <pre className="bg-gray-50 rounded-lg p-4 overflow-auto text-sm font-mono max-h-96">
          {policy.content}
        </pre>
      </div>

      {/* Version History */}
      {policy.versions && policy.versions.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t.versionHistory}
          </h2>
          <div className="space-y-2">
            {policy.versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
              >
                <div>
                  <span className="font-medium">v{version.version}</span>
                  {version.comment && (
                    <span className="text-gray-500 ml-2">{version.comment}</span>
                  )}
                </div>
                <span className="text-sm text-gray-500">
                  {new Date(version.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

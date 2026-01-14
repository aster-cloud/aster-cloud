'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PolicyVersionsTab } from '@/components/policy/policy-versions-tab';

interface PolicyVersion {
  id: string;
  version: number;
  content: string;
  comment: string | null;
  createdAt: string;
}

interface Policy {
  id: string;
  name: string;
  description: string | null;
  content: string;
  version: number;
  isPublic: boolean;
  shareSlug: string | null;
  piiFields: string[] | null;
  createdAt: string;
  updatedAt: string;
  versions: PolicyVersion[];
  _count: {
    executions: number;
  };
}

interface Translations {
  executeAction: string;
  edit: string;
  delete: string;
  confirmDelete: string;
  failedToDelete: string;
  public: string;
  private: string;
  detail: {
    version: string;
    executions: string;
    viewLogs: string;
    piiFields: string;
    status: string;
    piiWarning: string;
    piiWarningMessage: string;
    policyContent: string;
    versionHistory: string;
    backToPolicies: string;
  };
  deleteDialog: {
    title: string;
    description: string;
    confirm: string;
    cancel: string;
  };
}

interface PolicyDetailContentProps {
  policy: Policy;
  translations: Translations;
  locale: string;
}

export function PolicyDetailContent({
  policy,
  translations: t,
  locale,
}: PolicyDetailContentProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = useCallback(() => {
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/policies/${policy.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete policy');
      setDeleteDialogOpen(false);
      router.push(`/${locale}/policies`);
    } catch (err) {
      setError(t.failedToDelete);
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  }, [policy.id, locale, router, t.failedToDelete]);

  const handleCancelDelete = useCallback(() => {
    if (isDeleting) return;
    setDeleteDialogOpen(false);
  }, [isDeleting]);

  return (
    <div className="max-w-4xl mx-auto">
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div>
          <div className="flex items-center">
            <Link href={`/${locale}/policies`} className="text-gray-400 hover:text-gray-600 mr-2">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">{policy.name}</h1>
          </div>
          {policy.description && (
            <p className="mt-1 text-sm text-gray-500">{policy.description}</p>
          )}
        </div>
        <div className="mt-4 md:mt-0 flex space-x-3">
          <Link
            href={`/${locale}/policies/${policy.id}/execute`}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            {t.executeAction}
          </Link>
          <Link
            href={`/${locale}/policies/${policy.id}/edit`}
            className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            {t.edit}
          </Link>
          <button
            onClick={handleDeleteClick}
            className="inline-flex items-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
          >
            {t.delete}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-4 mb-6">
        <div className="bg-white overflow-hidden rounded-lg shadow px-4 py-5">
          <dt className="text-sm font-medium text-gray-500 truncate">{t.detail.version}</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">v{policy.version}</dd>
        </div>
        <Link
          href={`/${locale}/policies/${policy.id}/logs`}
          className="bg-white overflow-hidden rounded-lg shadow px-4 py-5 hover:bg-gray-50 transition-colors block"
        >
          <dt className="text-sm font-medium text-gray-500 truncate">{t.detail.executions}</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">{policy._count.executions}</dd>
          <p className="mt-1 text-xs text-indigo-600">{t.detail.viewLogs} →</p>
        </Link>
        <div className="bg-white overflow-hidden rounded-lg shadow px-4 py-5">
          <dt className="text-sm font-medium text-gray-500 truncate">{t.detail.piiFields}</dt>
          <dd className="mt-1 text-2xl font-semibold text-gray-900">
            {policy.piiFields?.length || 0}
          </dd>
        </div>
        <div className="bg-white overflow-hidden rounded-lg shadow px-4 py-5">
          <dt className="text-sm font-medium text-gray-500 truncate">{t.detail.status}</dt>
          <dd className="mt-1">
            {policy.isPublic ? (
              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">
                {t.public}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-medium text-gray-800">
                {t.private}
              </span>
            )}
          </dd>
        </div>
      </div>

      {/* PII Warning */}
      {policy.piiFields && policy.piiFields.length > 0 && (
        <div className="mb-6 rounded-md bg-yellow-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">{t.detail.piiWarning}</h3>
              <p className="mt-1 text-sm text-yellow-700">
                {t.detail.piiWarningMessage}{' '}
                <span className="font-medium">{policy.piiFields.join(', ')}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="bg-white shadow sm:rounded-lg mb-6">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">{t.detail.policyContent}</h3>
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
            {policy.content}
          </pre>
        </div>
      </div>

      {/* Version Management with Approval Workflow */}
      <PolicyVersionsTab policyId={policy.id} />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title={t.deleteDialog.title}
        description={t.deleteDialog.description.replace('{name}', policy.name)}
        confirmLabel={t.deleteDialog.confirm}
        cancelLabel={t.deleteDialog.cancel}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}

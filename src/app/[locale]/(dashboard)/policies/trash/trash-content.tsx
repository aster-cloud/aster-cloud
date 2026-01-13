'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface TrashItem {
  id: string;
  policyId: string;
  name: string;
  description: string | null;
  deletedAt: string;
  expiresAt: string;
  daysRemaining: number;
}

interface TrashStats {
  total: number;
  expiringWithin7Days: number;
}

interface Translations {
  trash: {
    title: string;
    description: string;
    backToPolicies: string;
    empty: string;
    emptyTrash: string;
    confirmEmptyTrash: string;
    restore: string;
    permanentDelete: string;
    confirmPermanentDelete: string;
    deletedAt: string;
    expiresAt: string;
    reason: string;
    noReason: string;
    restoreSuccess: string;
    restoreWithNewName: string;
    deleteSuccess: string;
    emptySuccess: string;
    loadError: string;
    actionError: string;
    itemCount: string;
    daysRemaining: string;
  };
}

interface TrashContentProps {
  translations: Translations;
  locale: string;
}

export function TrashContent({ translations: t, locale }: TrashContentProps) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [stats, setStats] = useState<TrashStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'delete' | 'empty';
    policyId?: string;
    policyName?: string;
  } | null>(null);

  const fetchTrash = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/policies/trash');
      if (!res.ok) throw new Error('Failed to fetch trash');

      const data = await res.json();
      setItems(data.items || []);
      setStats(data.stats || null);
    } catch (err) {
      setError(t.trash.loadError);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [t.trash.loadError]);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const restorePolicy = async (policyId: string) => {
    setActionLoading(policyId);
    setError('');
    setSuccessMessage('');

    try {
      const res = await fetch(`/api/policies/trash/${policyId}`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Failed to restore policy');

      const data = await res.json();
      if (data.nameConflict) {
        setSuccessMessage(t.trash.restoreWithNewName.replace('{name}', data.newName));
      } else {
        setSuccessMessage(t.trash.restoreSuccess);
      }

      await fetchTrash();
    } catch (err) {
      setError(t.trash.actionError);
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteClick = (policyId: string, policyName: string) => {
    setConfirmDialog({ type: 'delete', policyId, policyName });
  };

  const handleEmptyTrashClick = () => {
    setConfirmDialog({ type: 'empty' });
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog) return;

    if (confirmDialog.type === 'delete' && confirmDialog.policyId) {
      setActionLoading(confirmDialog.policyId);
      setError('');
      setSuccessMessage('');

      try {
        const res = await fetch(`/api/policies/trash/${confirmDialog.policyId}`, {
          method: 'DELETE',
        });

        if (!res.ok) throw new Error('Failed to delete policy');

        setSuccessMessage(t.trash.deleteSuccess);
        await fetchTrash();
      } catch (err) {
        setError(t.trash.actionError);
        console.error(err);
      } finally {
        setActionLoading(null);
        setConfirmDialog(null);
      }
    } else if (confirmDialog.type === 'empty') {
      setActionLoading('empty');
      setError('');
      setSuccessMessage('');

      try {
        const res = await fetch('/api/policies/trash', {
          method: 'DELETE',
        });

        if (!res.ok) throw new Error('Failed to empty trash');

        const data = await res.json();
        setSuccessMessage(t.trash.emptySuccess.replace('{count}', data.deletedCount.toString()));
        await fetchTrash();
      } catch (err) {
        setError(t.trash.actionError);
        console.error(err);
      } finally {
        setActionLoading(null);
        setConfirmDialog(null);
      }
    }
  };

  const getDaysRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div className="flex items-center">
          <Link href={`/${locale}/policies`} className="text-gray-400 hover:text-gray-600 mr-2">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t.trash.title}</h1>
            <p className="text-sm text-gray-500">{t.trash.description}</p>
          </div>
        </div>
        {items.length > 0 && (
          <button
            onClick={handleEmptyTrashClick}
            disabled={actionLoading === 'empty'}
            className="mt-4 md:mt-0 inline-flex items-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
          >
            {actionLoading === 'empty' ? '...' : t.trash.emptyTrash}
          </button>
        )}
      </div>

      {/* Stats */}
      {stats && stats.total > 0 && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-600">
            {t.trash.itemCount.replace('{count}', stats.total.toString())}
            {stats.expiringWithin7Days > 0 && (
              <span className="ml-2 text-orange-600">
                ({stats.expiringWithin7Days} expiring soon)
              </span>
            )}
          </p>
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-4 rounded-md bg-green-50 p-4">
          <p className="text-sm text-green-700">{successMessage}</p>
        </div>
      )}

      {/* Trash List */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            <p className="mt-2">{t.trash.empty}</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {items.map((item) => {
              const daysRemaining = item.daysRemaining ?? getDaysRemaining(item.expiresAt);
              const isExpiringSoon = daysRemaining <= 7;

              return (
                <li key={item.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {item.name}
                        </h3>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            isExpiringSoon
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {t.trash.daysRemaining.replace('{days}', daysRemaining.toString())}
                        </span>
                      </div>
                      {item.description && (
                        <p className="mt-1 text-sm text-gray-600 line-clamp-2">
                          {item.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center text-xs text-gray-400">
                        <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        {t.trash.deletedAt}: {formatDate(item.deletedAt, locale)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => restorePolicy(item.policyId)}
                        disabled={actionLoading === item.policyId}
                        className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {actionLoading === item.policyId ? '...' : t.trash.restore}
                      </button>
                      <button
                        onClick={() => handleDeleteClick(item.policyId, item.name)}
                        disabled={actionLoading === item.policyId}
                        className="inline-flex items-center rounded-md bg-red-100 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 transition-colors"
                      >
                        {t.trash.permanentDelete}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog !== null}
        title={
          confirmDialog?.type === 'empty'
            ? t.trash.emptyTrash
            : t.trash.permanentDelete
        }
        description={
          confirmDialog?.type === 'empty'
            ? t.trash.confirmEmptyTrash
            : t.trash.confirmPermanentDelete.replace('{name}', confirmDialog?.policyName || '')
        }
        confirmLabel={
          confirmDialog?.type === 'empty'
            ? t.trash.emptyTrash
            : t.trash.permanentDelete
        }
        variant="danger"
        isLoading={actionLoading !== null}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  );
}

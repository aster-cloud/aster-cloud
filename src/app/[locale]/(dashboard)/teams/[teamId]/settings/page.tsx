'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

interface Team {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export default function TeamSettingsPage() {
  const t = useTranslations('teams');
  const params = useParams();
  const router = useRouter();
  const teamId = params.teamId as string;

  const [team, setTeam] = useState<Team | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // 编辑表单
  const [formData, setFormData] = useState({ name: '', slug: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 删除确认
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchTeam();
  }, [teamId]);

  const fetchTeam = async () => {
    try {
      const res = await fetch(`/api/teams/${teamId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch team');
      }

      const data = await res.json();
      setTeam(data.team);
      setUserRole(data.role);
      setFormData({ name: data.team.name, slug: data.team.slug });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToLoad'));
    } finally {
      setIsLoading(false);
    }
  };

  const canEdit = userRole === 'owner' || userRole === 'admin';
  const canDelete = userRole === 'owner';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update team');
      }

      setTeam(data.team);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirmText !== team?.name) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete team');
      }

      router.push('/teams');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.deleteFailed'));
      setIsDeleting(false);
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

  if (!canEdit) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">{t('settings.noPermission')}</p>
        <Link
          href={`/teams/${teamId}`}
          className="mt-4 inline-flex items-center text-indigo-600 hover:text-indigo-700"
        >
          {t('backToTeam')}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
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

      <h1 className="text-2xl font-bold text-gray-900 mb-8">{t('settings.title')}</h1>

      {/* 基本信息 */}
      <div className="bg-white shadow rounded-lg mb-8">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">{t('settings.generalTitle')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('settings.generalSubtitle')}</p>
        </div>
        <form onSubmit={handleSave} className="px-6 py-4 space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          {saveSuccess && (
            <div className="rounded-md bg-green-50 p-4">
              <p className="text-sm text-green-700">{t('settings.saveSuccess')}</p>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              {t('settings.nameLabel')}
            </label>
            <input
              type="text"
              id="name"
              required
              minLength={2}
              maxLength={50}
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-gray-700">
              {t('settings.slugLabel')}
            </label>
            <div className="mt-1 flex rounded-md shadow-sm">
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-gray-500 sm:text-sm">
                /teams/
              </span>
              <input
                type="text"
                id="slug"
                required
                minLength={2}
                maxLength={50}
                pattern="[a-z0-9-]+"
                value={formData.slug}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                  }))
                }
                className="block w-full flex-1 rounded-none rounded-r-md border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">{t('settings.slugHint')}</p>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSaving ? t('saving') : t('settings.saveChanges')}
            </button>
          </div>
        </form>
      </div>

      {/* 危险区域 */}
      {canDelete && (
        <div className="bg-white shadow rounded-lg border-2 border-red-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-red-600">{t('settings.dangerZone')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('settings.dangerZoneSubtitle')}</p>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-gray-900">{t('settings.deleteTeamTitle')}</h3>
                <p className="text-sm text-gray-500">{t('settings.deleteTeamDescription')}</p>
              </div>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
              >
                {t('settings.deleteTeam')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认模态框 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-red-600">{t('settings.confirmDeleteTitle')}</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-600">{t('settings.confirmDeleteWarning')}</p>
              <ul className="text-sm text-gray-500 list-disc list-inside space-y-1">
                <li>{t('settings.deleteWarning1')}</li>
                <li>{t('settings.deleteWarning2')}</li>
                <li>{t('settings.deleteWarning3')}</li>
              </ul>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('settings.typeToConfirm', { name: team.name })}
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm"
                  placeholder={team.name}
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText('');
                  }}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t('cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteConfirmText !== team.name || isDeleting}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeleting ? t('deleting') : t('settings.confirmDelete')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SSO 和审计日志即将推出 */}
      <div className="mt-8 space-y-4">
        <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 bg-gray-200 rounded-lg">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div className="ml-4">
              <h3 className="text-sm font-medium text-gray-900">{t('settings.ssoTitle')}</h3>
              <p className="text-sm text-gray-500">{t('settings.ssoDescription')}</p>
            </div>
            <span className="ml-auto inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {t('comingSoon')}
            </span>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
          <div className="flex items-center">
            <div className="flex-shrink-0 p-2 bg-gray-200 rounded-lg">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            </div>
            <div className="ml-4">
              <h3 className="text-sm font-medium text-gray-900">{t('settings.auditLogsTitle')}</h3>
              <p className="text-sm text-gray-500">{t('settings.auditLogsDescription')}</p>
            </div>
            <span className="ml-auto inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {t('comingSoon')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { PolicyVersionList, type PolicyVersionInfo } from './policy-version-list';
import { VersionDetailPanel } from './version-detail-panel';
import { VersionComparePanel } from './version-compare-panel';
import { usePolicyVersions } from '@/hooks/use-policy-versions';

interface PolicyVersionsTabProps {
  policyId: string;
}

type ViewMode = 'list' | 'detail' | 'compare';

export function PolicyVersionsTab({ policyId }: PolicyVersionsTabProps) {
  const { data: session } = useSession();
  const {
    versions,
    loading,
    error,
    refresh,
    setDefault,
    deprecate,
    archive,
    submitForApproval,
    approve,
    reject,
  } = usePolicyVersions({ policyId });

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const handleViewSource = useCallback((version: number) => {
    setSelectedVersion(version);
    setViewMode('detail');
  }, []);

  const handleCloseDetail = useCallback(() => {
    setViewMode('list');
    setSelectedVersion(null);
  }, []);

  const handleOpenCompare = useCallback(() => {
    setViewMode('compare');
  }, []);

  const handleCloseCompare = useCallback(() => {
    setViewMode('list');
  }, []);

  // 将 version 传递给基于 version number 的 API
  const handleSetDefault = useCallback(
    async (version: number) => {
      await setDefault(version);
    },
    [setDefault]
  );

  const handleDeprecate = useCallback(
    async (version: number, reason?: string) => {
      await deprecate(version, reason);
    },
    [deprecate]
  );

  const handleArchive = useCallback(
    async (version: number, reason?: string) => {
      await archive(version, reason);
    },
    [archive]
  );

  // 这些 API 现在需要 version number 而不是 versionId
  const handleSubmitForApproval = useCallback(
    async (versionId: string) => {
      // 从 versions 中找到对应的 version number
      const ver = (versions as PolicyVersionInfo[]).find((v) => v.id === versionId);
      if (ver) {
        await submitForApproval(ver.version);
      }
    },
    [versions, submitForApproval]
  );

  const handleApprove = useCallback(
    async (versionId: string, comment?: string) => {
      const ver = (versions as PolicyVersionInfo[]).find((v) => v.id === versionId);
      if (ver) {
        await approve(ver.version, comment);
      }
    },
    [versions, approve]
  );

  const handleReject = useCallback(
    async (versionId: string, comment?: string) => {
      const ver = (versions as PolicyVersionInfo[]).find((v) => v.id === versionId);
      if (ver && comment) {
        await reject(ver.version, comment);
      }
    },
    [versions, reject]
  );

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 shadow sm:rounded-lg p-6">
        <div className="text-red-500 dark:text-red-400">{error}</div>
        <button
          onClick={refresh}
          className="mt-4 text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            版本管理
          </h3>
          {viewMode === 'list' && (versions as PolicyVersionInfo[]).length >= 2 && (
            <button
              onClick={handleOpenCompare}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              版本对比
            </button>
          )}
        </div>

        {/* Content */}
        {viewMode === 'list' && (
          <PolicyVersionList
            versions={versions as PolicyVersionInfo[]}
            loading={loading}
            currentUserId={session?.user?.id}
            onViewSource={handleViewSource}
            onSetDefault={handleSetDefault}
            onDeprecate={handleDeprecate}
            onArchive={handleArchive}
            onSubmitForApproval={handleSubmitForApproval}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}

        {viewMode === 'detail' && selectedVersion !== null && (
          <VersionDetailPanel
            policyId={policyId}
            version={selectedVersion}
            onClose={handleCloseDetail}
          />
        )}

        {viewMode === 'compare' && (
          <VersionComparePanel
            policyId={policyId}
            versions={(versions as PolicyVersionInfo[]).map((v) => ({
              version: v.version,
              status: v.status,
              isDefault: v.isDefault,
              releaseNote: v.releaseNote,
              createdAt: v.createdAt,
            }))}
            onClose={handleCloseCompare}
          />
        )}
      </div>
    </div>
  );
}

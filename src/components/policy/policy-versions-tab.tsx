'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('policies.versions');
  const tCommon = useTranslations('common');
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
  const [inviteModal, setInviteModal] = useState<
    | { open: false }
    | { open: true; message: string; cta: { label: string; href: string } }
  >({ open: false });

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
      if (!ver) return;

      const result = await approve(ver.version, comment);
      if (result.ok) return;

      if (result.errorCode === 'invite_reviewer_required') {
        setInviteModal({
          open: true,
          message:
            result.message ??
            'Approval requires a separate reviewer. Invite a teammate to your workspace.',
          cta: result.cta ?? { label: 'Invite a teammate', href: '/teams/new' },
        });
      }
    },
    [versions, approve]
  );

  const closeInviteModal = useCallback(() => setInviteModal({ open: false }), []);

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
      <div className="bg-bg dark:bg-gray-800 shadow sm:rounded-lg p-6">
        <div className="text-red-500 dark:text-red-400">{error}</div>
        <button
          onClick={refresh}
          className="mt-4 text-primary dark:text-primary hover:underline"
        >
          {tCommon('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-bg dark:bg-gray-800 shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-fg dark:text-white">
            {t('panelTitle')}
          </h3>
          {viewMode === 'list' && (versions as PolicyVersionInfo[]).length >= 2 && (
            <button
              onClick={handleOpenCompare}
              className="text-sm text-primary dark:text-primary hover:underline"
            >
              {t('compare')}
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

      {inviteModal.open && (
        <InviteReviewerModal
          message={inviteModal.message}
          cta={inviteModal.cta}
          onClose={closeInviteModal}
        />
      )}
    </div>
  );
}

function InviteReviewerModal({
  message,
  cta,
  onClose,
}: {
  message: string;
  cta: { label: string; href: string };
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-bg dark:bg-gray-800 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-fg dark:text-white">
          Invite a reviewer
        </h3>
        <p className="mt-2 text-sm text-fg-muted dark:text-gray-300">{message}</p>
        <p className="mt-3 text-xs text-fg-muted dark:text-fg-subtle">
          SOX Segregation of Duties requires a different person to approve.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-medium text-fg-muted hover:bg-bg-muted dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <a
            href={cta.href}
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
          >
            {cta.label}
          </a>
        </div>
      </div>
    </div>
  );
}

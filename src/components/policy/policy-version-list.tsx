'use client';

import { useState, useCallback } from 'react';
import type { PolicyVersionStatus } from '@/lib/prisma';
import { VersionStatusBadge } from './version-status-badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface PolicyVersionInfo {
  id: string;
  version: number;
  sourceHash: string | null;
  status: PolicyVersionStatus;
  isDefault: boolean;
  releaseNote: string | null;
  createdBy: string;
  createdAt: string;
  deprecatedAt: string | null;
  deprecatedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  _count?: { approvals: number };
}

interface PolicyVersionListProps {
  versions: PolicyVersionInfo[];
  loading?: boolean;
  currentUserId?: string;
  onSetDefault?: (version: number) => Promise<void>;
  onDeprecate?: (version: number, reason?: string) => Promise<void>;
  onArchive?: (version: number, reason?: string) => Promise<void>;
  onSubmitForApproval?: (versionId: string) => Promise<void>;
  onApprove?: (versionId: string, comment?: string) => Promise<void>;
  onReject?: (versionId: string, comment?: string) => Promise<void>;
  onViewSource?: (version: number) => void;
}

type ActionType = 'set-default' | 'deprecate' | 'archive' | 'submit' | 'approve' | 'reject';

interface ActionDialogState {
  open: boolean;
  type: ActionType | null;
  version: PolicyVersionInfo | null;
}

export function PolicyVersionList({
  versions,
  loading = false,
  currentUserId,
  onSetDefault,
  onDeprecate,
  onArchive,
  onSubmitForApproval,
  onApprove,
  onReject,
  onViewSource,
}: PolicyVersionListProps) {
  const [actionDialog, setActionDialog] = useState<ActionDialogState>({
    open: false,
    type: null,
    version: null,
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [comment, setComment] = useState('');

  const openActionDialog = useCallback((type: ActionType, version: PolicyVersionInfo) => {
    setActionDialog({ open: true, type, version });
    setComment('');
  }, []);

  const closeActionDialog = useCallback(() => {
    if (actionLoading) return;
    setActionDialog({ open: false, type: null, version: null });
    setComment('');
  }, [actionLoading]);

  const handleConfirmAction = useCallback(async () => {
    if (!actionDialog.version || !actionDialog.type) return;

    setActionLoading(true);
    try {
      switch (actionDialog.type) {
        case 'set-default':
          await onSetDefault?.(actionDialog.version.version);
          break;
        case 'deprecate':
          await onDeprecate?.(actionDialog.version.version, comment || undefined);
          break;
        case 'archive':
          await onArchive?.(actionDialog.version.version, comment || undefined);
          break;
        case 'submit':
          await onSubmitForApproval?.(actionDialog.version.id);
          break;
        case 'approve':
          await onApprove?.(actionDialog.version.id, comment || undefined);
          break;
        case 'reject':
          await onReject?.(actionDialog.version.id, comment || undefined);
          break;
      }
      closeActionDialog();
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setActionLoading(false);
    }
  }, [
    actionDialog,
    comment,
    onSetDefault,
    onDeprecate,
    onArchive,
    onSubmitForApproval,
    onApprove,
    onReject,
    closeActionDialog,
  ]);

  const getDialogConfig = useCallback(() => {
    const v = actionDialog.version;
    switch (actionDialog.type) {
      case 'set-default':
        return {
          title: '设置默认版本',
          description: `确定要将 v${v?.version} 设为默认执行版本吗？`,
          confirmLabel: '确认设置',
          variant: 'info' as const,
          showComment: false,
        };
      case 'deprecate':
        return {
          title: '废弃版本',
          description: `确定要废弃 v${v?.version} 吗？废弃后该版本仍可执行，但会显示警告。`,
          confirmLabel: '确认废弃',
          variant: 'warning' as const,
          showComment: true,
          commentPlaceholder: '废弃原因（可选）',
        };
      case 'archive':
        return {
          title: '归档版本',
          description: `确定要归档 v${v?.version} 吗？归档后该版本将不可执行。`,
          confirmLabel: '确认归档',
          variant: 'danger' as const,
          showComment: true,
          commentPlaceholder: '归档原因（可选）',
        };
      case 'submit':
        return {
          title: '提交审批',
          description: `确定要将 v${v?.version} 提交审批吗？`,
          confirmLabel: '提交',
          variant: 'info' as const,
          showComment: false,
        };
      case 'approve':
        return {
          title: '批准版本',
          description: `确定要批准 v${v?.version} 吗？批准后该版本可被执行。`,
          confirmLabel: '批准',
          variant: 'info' as const,
          showComment: true,
          commentPlaceholder: '审批意见（可选）',
        };
      case 'reject':
        return {
          title: '拒绝版本',
          description: `确定要拒绝 v${v?.version} 吗？`,
          confirmLabel: '拒绝',
          variant: 'danger' as const,
          showComment: true,
          commentPlaceholder: '拒绝原因（必填）',
          commentRequired: true,
        };
      default:
        return {
          title: '',
          description: '',
          confirmLabel: '确认',
          variant: 'info' as const,
          showComment: false,
        };
    }
  }, [actionDialog]);

  const dialogConfig = getDialogConfig();

  // Check if user can approve (four-eyes principle: creator cannot approve)
  const canApprove = useCallback(
    (version: PolicyVersionInfo) => {
      return currentUserId && version.createdBy !== currentUserId;
    },
    [currentUserId]
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        ))}
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        暂无版本记录
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {versions.map((version) => (
          <div
            key={version.id}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    v{version.version}
                  </span>
                  <VersionStatusBadge status={version.status} isDefault={version.isDefault} />
                </div>

                {version.releaseNote && (
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {version.releaseNote}
                  </p>
                )}

                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-500">
                  <span>
                    创建于 {new Date(version.createdAt).toLocaleString('zh-CN')}
                  </span>
                  {version.sourceHash && (
                    <span className="font-mono">
                      {version.sourceHash.substring(0, 16)}...
                    </span>
                  )}
                  {version._count?.approvals !== undefined && version._count.approvals > 0 && (
                    <span>{version._count.approvals} 条审批记录</span>
                  )}
                </div>

                {version.deprecatedAt && (
                  <p className="mt-1 text-xs text-orange-600 dark:text-orange-400">
                    废弃于 {new Date(version.deprecatedAt).toLocaleString('zh-CN')}
                  </p>
                )}

                {version.archivedAt && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                    归档于 {new Date(version.archivedAt).toLocaleString('zh-CN')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {/* View Source */}
                {onViewSource && (
                  <button
                    onClick={() => onViewSource(version.version)}
                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-2 py-1"
                  >
                    查看源码
                  </button>
                )}

                {/* Status-specific actions */}
                {version.status === 'DRAFT' && onSubmitForApproval && (
                  <button
                    onClick={() => openActionDialog('submit', version)}
                    className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md"
                  >
                    提交审批
                  </button>
                )}

                {version.status === 'PENDING_APPROVAL' && canApprove(version) && (
                  <>
                    <button
                      onClick={() => openActionDialog('approve', version)}
                      className="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-md"
                    >
                      批准
                    </button>
                    <button
                      onClick={() => openActionDialog('reject', version)}
                      className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md"
                    >
                      拒绝
                    </button>
                  </>
                )}

                {version.status === 'PENDING_APPROVAL' && !canApprove(version) && (
                  <span className="text-xs text-yellow-600 dark:text-yellow-400">
                    等待他人审批
                  </span>
                )}

                {version.status === 'APPROVED' && !version.isDefault && onSetDefault && (
                  <button
                    onClick={() => openActionDialog('set-default', version)}
                    className="text-sm bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 px-3 py-1.5 rounded-md"
                  >
                    设为默认
                  </button>
                )}

                {version.status === 'APPROVED' && !version.isDefault && onDeprecate && (
                  <button
                    onClick={() => openActionDialog('deprecate', version)}
                    className="text-sm text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 px-2 py-1"
                  >
                    废弃
                  </button>
                )}

                {(version.status === 'APPROVED' || version.status === 'DEPRECATED') &&
                  !version.isDefault &&
                  onArchive && (
                    <button
                      onClick={() => openActionDialog('archive', version)}
                      className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1"
                    >
                      归档
                    </button>
                  )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Action Dialog */}
      <ConfirmDialog
        isOpen={actionDialog.open}
        onCancel={closeActionDialog}
        onConfirm={handleConfirmAction}
        title={dialogConfig.title}
        description={
          dialogConfig.showComment ? (
            <div className="space-y-3">
              <p>{dialogConfig.description}</p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={dialogConfig.commentPlaceholder}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500"
                rows={3}
              />
            </div>
          ) : (
            dialogConfig.description
          )
        }
        confirmLabel={dialogConfig.confirmLabel}
        cancelLabel="取消"
        variant={dialogConfig.variant}
        isLoading={actionLoading}
      />
    </>
  );
}

export type { PolicyVersionInfo };

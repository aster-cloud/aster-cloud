'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PolicyVersionStatus } from '@prisma/client';
import { VersionStatusBadge } from './version-status-badge';

interface ApprovalRecord {
  id: string;
  approverId: string;
  decision: 'APPROVED' | 'REJECTED' | 'REQUESTED_CHANGES';
  comment: string | null;
  createdAt: string;
}

interface VersionDetail {
  id: string;
  version: number;
  source: string | null;
  content: string;
  sourceHash: string | null;
  prevHash: string | null;
  status: PolicyVersionStatus;
  isDefault: boolean;
  releaseNote: string | null;
  createdBy: string;
  createdAt: string;
  deprecatedAt: string | null;
  deprecatedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  approvals: ApprovalRecord[];
}

interface VersionDetailPanelProps {
  policyId: string;
  version: number;
  onClose?: () => void;
}

const decisionLabels: Record<string, { label: string; color: string }> = {
  APPROVED: { label: '批准', color: 'text-green-600 dark:text-green-400' },
  REJECTED: { label: '拒绝', color: 'text-red-600 dark:text-red-400' },
  REQUESTED_CHANGES: { label: '需修改', color: 'text-yellow-600 dark:text-yellow-400' },
};

export function VersionDetailPanel({
  policyId,
  version,
  onClose,
}: VersionDetailPanelProps) {
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'source' | 'metadata' | 'approvals'>('source');

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/policies/${policyId}/versions/${version}`);
      const data = await response.json();

      if (response.ok) {
        setDetail(data);
      } else {
        setError(data.error || '获取版本详情失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [policyId, version]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <div className="text-red-500 dark:text-red-400">{error}</div>
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  const sourceCode = detail.source ?? detail.content;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            v{detail.version}
          </h2>
          <VersionStatusBadge status={detail.status} isDefault={detail.isDefault} />
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex -mb-px px-6">
          {[
            { id: 'source' as const, label: '源码' },
            { id: 'metadata' as const, label: '元数据' },
            { id: 'approvals' as const, label: `审批记录 (${detail.approvals.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'source' && (
          <div className="space-y-4">
            {detail.releaseNote && (
              <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                {detail.releaseNote}
              </div>
            )}
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono max-h-[500px] overflow-y-auto">
              {sourceCode}
            </pre>
          </div>
        )}

        {activeTab === 'metadata' && (
          <div className="space-y-4">
            <MetadataItem label="版本 ID" value={detail.id} mono />
            <MetadataItem label="版本号" value={`v${detail.version}`} />
            <MetadataItem label="状态" value={detail.status} />
            <MetadataItem label="是否默认" value={detail.isDefault ? '是' : '否'} />
            <MetadataItem label="源码哈希" value={detail.sourceHash || '无'} mono />
            <MetadataItem label="前一版本哈希" value={detail.prevHash || '无'} mono />
            <MetadataItem label="创建者" value={detail.createdBy} />
            <MetadataItem
              label="创建时间"
              value={new Date(detail.createdAt).toLocaleString('zh-CN')}
            />
            {detail.deprecatedAt && (
              <>
                <MetadataItem label="废弃者" value={detail.deprecatedBy || '未知'} />
                <MetadataItem
                  label="废弃时间"
                  value={new Date(detail.deprecatedAt).toLocaleString('zh-CN')}
                />
              </>
            )}
            {detail.archivedAt && (
              <>
                <MetadataItem label="归档者" value={detail.archivedBy || '未知'} />
                <MetadataItem
                  label="归档时间"
                  value={new Date(detail.archivedAt).toLocaleString('zh-CN')}
                />
              </>
            )}
          </div>
        )}

        {activeTab === 'approvals' && (
          <div className="space-y-4">
            {detail.approvals.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                暂无审批记录
              </div>
            ) : (
              detail.approvals.map((approval) => {
                const decisionInfo = decisionLabels[approval.decision] || {
                  label: approval.decision,
                  color: 'text-gray-600',
                };
                return (
                  <div
                    key={approval.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`font-medium ${decisionInfo.color}`}>
                        {decisionInfo.label}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {new Date(approval.createdAt).toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      审批人: {approval.approverId}
                    </div>
                    {approval.comment && (
                      <div className="mt-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 p-2 rounded">
                        {approval.comment}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetadataItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span
        className={`text-sm text-gray-900 dark:text-white ${mono ? 'font-mono' : ''} max-w-[60%] break-all text-right`}
      >
        {value}
      </span>
    </div>
  );
}

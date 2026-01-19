'use client';

import type { PolicyVersionStatus } from '@/lib/prisma';

interface VersionStatusBadgeProps {
  status: PolicyVersionStatus;
  isDefault?: boolean;
  size?: 'sm' | 'md';
}

const statusConfig: Record<
  PolicyVersionStatus,
  { label: string; labelZh: string; bgColor: string; textColor: string }
> = {
  DRAFT: {
    label: 'Draft',
    labelZh: '草稿',
    bgColor: 'bg-gray-100 dark:bg-gray-700',
    textColor: 'text-gray-700 dark:text-gray-300',
  },
  PENDING_APPROVAL: {
    label: 'Pending',
    labelZh: '待审批',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900',
    textColor: 'text-yellow-800 dark:text-yellow-200',
  },
  APPROVED: {
    label: 'Approved',
    labelZh: '已批准',
    bgColor: 'bg-green-100 dark:bg-green-900',
    textColor: 'text-green-800 dark:text-green-200',
  },
  REJECTED: {
    label: 'Rejected',
    labelZh: '已拒绝',
    bgColor: 'bg-red-100 dark:bg-red-900',
    textColor: 'text-red-800 dark:text-red-200',
  },
  DEPRECATED: {
    label: 'Deprecated',
    labelZh: '已废弃',
    bgColor: 'bg-orange-100 dark:bg-orange-900',
    textColor: 'text-orange-800 dark:text-orange-200',
  },
  ARCHIVED: {
    label: 'Archived',
    labelZh: '已归档',
    bgColor: 'bg-gray-200 dark:bg-gray-600',
    textColor: 'text-gray-600 dark:text-gray-400',
  },
};

export function VersionStatusBadge({
  status,
  isDefault = false,
  size = 'sm',
}: VersionStatusBadgeProps) {
  const config = statusConfig[status];
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full font-medium ${sizeClasses} ${config.bgColor} ${config.textColor}`}
      >
        {config.labelZh}
      </span>
      {isDefault && (
        <span
          className={`inline-flex items-center rounded-full font-medium ${sizeClasses} bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200`}
        >
          默认
        </span>
      )}
    </span>
  );
}

export { statusConfig };

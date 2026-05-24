'use client';

import { useTranslations } from 'next-intl';
import type { PolicyVersionStatus } from '@/lib/prisma';

interface VersionStatusBadgeProps {
  status: PolicyVersionStatus;
  isDefault?: boolean;
  size?: 'sm' | 'md';
}

// Colors stay here (cross-locale concern); label text now comes from
// the i18n bundle so de/en don't fall back to zh hardcoded labels.
const statusColors: Record<
  PolicyVersionStatus,
  { bgColor: string; textColor: string }
> = {
  DRAFT: {
    bgColor: 'bg-bg-muted dark:bg-gray-700',
    textColor: 'text-fg dark:text-gray-300',
  },
  PENDING_APPROVAL: {
    bgColor: 'bg-yellow-100 dark:bg-yellow-900',
    textColor: 'text-yellow-800 dark:text-yellow-200',
  },
  APPROVED: {
    bgColor: 'bg-green-100 dark:bg-green-900',
    textColor: 'text-green-800 dark:text-green-200',
  },
  REJECTED: {
    bgColor: 'bg-red-100 dark:bg-red-900',
    textColor: 'text-red-800 dark:text-red-200',
  },
  DEPRECATED: {
    bgColor: 'bg-orange-100 dark:bg-orange-900',
    textColor: 'text-orange-800 dark:text-orange-200',
  },
  ARCHIVED: {
    bgColor: 'bg-bg-muted dark:bg-gray-600',
    textColor: 'text-fg-muted dark:text-fg-subtle',
  },
};

export function VersionStatusBadge({
  status,
  isDefault = false,
  size = 'sm',
}: VersionStatusBadgeProps) {
  const t = useTranslations('policies.versions');
  const colors = statusColors[status];
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full font-medium ${sizeClasses} ${colors.bgColor} ${colors.textColor}`}
      >
        {t(`status.${status}`)}
      </span>
      {isDefault && (
        <span
          className={`inline-flex items-center rounded-full font-medium ${sizeClasses} bg-primary-subtle dark:bg-primary-active text-primary-hover dark:text-primary-fg`}
        >
          {t('isDefault')}
        </span>
      )}
    </span>
  );
}

// Backwards-compat re-export for callers that imported the old name.
export { statusColors as statusConfig };

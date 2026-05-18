// StatusAdvisories — primary banner 之外的低噪声提示。
//
// 设计意图：
//   - advisory 不使用 role="alert/status"，避免屏幕阅读器把次要信息当成新告警
//   - 只渲染 inline list；复杂状态仍由唯一 primary banner 承担

'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LicenseResult, SecondaryAdvisory } from '@/lib/license';
import type { LicenseCacheMeta } from '../license-content';

interface Props {
  result: LicenseResult;
  cacheMeta?: LicenseCacheMeta | null;
}

const ADVISORY_KEYS: Record<SecondaryAdvisory, string> = {
  'expiring-soon': 'advisory.expiringSoon',
  'revocation-stale': 'advisory.revocationStale',
  'network-grace': 'advisory.networkGrace',
  'legacy-unsigned-active': 'advisory.legacyUnsignedActive',
};

export function StatusAdvisories({ result, cacheMeta }: Props) {
  const t = useTranslations('admin.license');

  if (result.secondaryAdvisories.length === 0) {
    return null;
  }

  return (
    <aside
      aria-label={t('advisory.heading')}
      data-license-advisories="inline"
      className="rounded-lg border border-border bg-bg-subtle px-4 py-3"
    >
      <ul className="space-y-2 text-sm text-fg-muted" role="list">
        {result.secondaryAdvisories.map((advisory) => (
          <li key={advisory} className="flex gap-2">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t(ADVISORY_KEYS[advisory], {
                days: Math.abs(result.daysRemaining ?? 0),
                minutes: cacheMeta?.lastCheckMinutesAgo ?? 0,
              })}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

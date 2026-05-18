// LicenseStatusSummary — 单一 primary banner。
//
// 设计意图：
//   - displayStatus 到 tone / aria role 的映射必须严格匹配 plan section 2.3
//   - 不在这里渲染 secondary advisory，避免多个 banner 同时竞争 operator 注意力
//   - icon + text + tone 同时表达状态，不只依赖颜色（a11y）

'use client';

import { AlertCircle, Check, Info, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DisplayStatus, LicenseResult } from '@/lib/license';
import type { LicenseCacheMeta } from '../license-content';
import { FormattedDate } from './license-details';

type Tone = 'success' | 'warning' | 'strong-warning' | 'danger' | 'info';

const STATUS_CONFIG: Record<
  DisplayStatus,
  {
    tone: Tone;
    role: 'status' | 'alert';
    titleKey: string;
    bodyKey: string;
    icon: 'check' | 'alert' | 'info' | 'shield';
  }
> = {
  missing: {
    tone: 'danger',
    role: 'alert',
    titleKey: 'status.missing.title',
    bodyKey: 'status.missing.body',
    icon: 'alert',
  },
  malformed: {
    tone: 'danger',
    role: 'alert',
    titleKey: 'status.malformed.title',
    bodyKey: 'status.malformed.body',
    icon: 'alert',
  },
  'signature-invalid': {
    tone: 'danger',
    role: 'alert',
    titleKey: 'status.signatureInvalid.title',
    bodyKey: 'status.signatureInvalid.body',
    icon: 'alert',
  },
  'signature-untrusted-key': {
    tone: 'danger',
    role: 'alert',
    titleKey: 'status.signatureUntrustedKey.title',
    bodyKey: 'status.signatureUntrustedKey.body',
    icon: 'alert',
  },
  'legacy-unsigned': {
    tone: 'warning',
    role: 'status',
    titleKey: 'status.legacyUnsigned.title',
    bodyKey: 'status.legacyUnsigned.body',
    icon: 'shield',
  },
  'verified-revoked': {
    tone: 'danger',
    role: 'alert',
    titleKey: 'status.verifiedRevoked.title',
    bodyKey: 'status.verifiedRevoked.body',
    icon: 'alert',
  },
  'verified-expired': {
    tone: 'danger',
    role: 'alert',
    titleKey: 'status.verifiedExpired.title',
    bodyKey: 'status.verifiedExpired.body',
    icon: 'alert',
  },
  'network-grace-expired': {
    tone: 'strong-warning',
    role: 'alert',
    titleKey: 'status.networkGraceExpired.title',
    bodyKey: 'status.networkGraceExpired.body',
    icon: 'alert',
  },
  'verified-expiring-soon': {
    tone: 'warning',
    role: 'status',
    titleKey: 'status.verifiedExpiringSoon.title',
    bodyKey: 'status.verifiedExpiringSoon.body',
    icon: 'alert',
  },
  'network-grace': {
    tone: 'info',
    role: 'status',
    titleKey: 'status.networkGrace.title',
    bodyKey: 'status.networkGrace.body',
    icon: 'info',
  },
  'verified-active': {
    tone: 'success',
    role: 'status',
    titleKey: 'status.verifiedActive.title',
    bodyKey: 'status.verifiedActive.body',
    icon: 'check',
  },
};

export function LicenseStatusSummary({
  result,
  cacheMeta,
}: {
  result: LicenseResult;
  cacheMeta?: LicenseCacheMeta | null;
}) {
  const t = useTranslations('admin.license');
  const config = STATUS_CONFIG[result.displayStatus];
  const days = Math.abs(result.daysRemaining ?? 0);
  const minutes = cacheMeta?.lastCheckMinutesAgo ?? 0;

  return (
    <section
      role={config.role}
      aria-live={config.role === 'alert' ? 'assertive' : 'polite'}
      data-license-banner="primary"
      data-tone={config.tone}
      className={`rounded-lg border p-4 ${toneClasses(config.tone)}`}
    >
      <div className="flex gap-3">
        <StatusIcon icon={config.icon} />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t(config.titleKey)}</h2>
          <p className="mt-1 text-sm">
            {t(config.bodyKey, { days, minutes })}
          </p>
          <StatusCta result={result} cacheMeta={cacheMeta} />
        </div>
      </div>
    </section>
  );
}

function StatusCta({
  result,
  cacheMeta,
}: {
  result: LicenseResult;
  cacheMeta?: LicenseCacheMeta | null;
}) {
  const t = useTranslations('admin.license');

  if (result.displayStatus === 'missing') {
    return (
      <p className="mt-2 text-xs">
        {t('status.missing.cta')}{' '}
        <code className="rounded bg-bg-subtle px-1 py-0.5">LICENSE_KEY</code>
      </p>
    );
  }
  if (result.displayStatus === 'legacy-unsigned') {
    return <p className="mt-2 text-xs">{t('status.legacyUnsigned.deadline')}</p>;
  }
  if (result.displayStatus === 'network-grace-expired' && cacheMeta?.graceEndedAt) {
    return (
      <p className="mt-2 text-xs">
        {t('revocation.graceExpired')}:{' '}
        <FormattedDate iso={cacheMeta.graceEndedAt} />
      </p>
    );
  }
  return null;
}

function StatusIcon({ icon }: { icon: 'check' | 'alert' | 'info' | 'shield' }) {
  const className = 'mt-0.5 h-5 w-5 shrink-0';
  if (icon === 'check') return <Check aria-hidden="true" className={className} />;
  if (icon === 'info') return <Info aria-hidden="true" className={className} />;
  if (icon === 'shield') return <Shield aria-hidden="true" className={className} />;
  return <AlertCircle aria-hidden="true" className={className} />;
}

function toneClasses(tone: Tone): string {
  return {
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200',
    warning:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200',
    'strong-warning':
      'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100',
    danger:
      'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200',
    info:
      'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200',
  }[tone];
}

// RevocationStatusPanel — 撤销检查事实与 air-gapped policy note。
//
// 设计意图：
//   - air-gapped SKU 显示中性 policy note，明确"禁用"是合同/SKU 策略而非故障
//   - 没有 payload 时不渲染，避免 missing/malformed 状态下出现无意义的网络信息
//   - standard SKU 同时展示 relative copy（minutesAgo）与绝对 ISO 时间

'use client';

import { useTranslations } from 'next-intl';
import type { LicenseResult } from '@/lib/license';
import type { LicenseCacheMeta } from '../license-content';
import { DetailRow, FormattedDate } from './license-details';

interface Props {
  result: LicenseResult;
  cacheMeta?: LicenseCacheMeta | null;
}

export function RevocationStatusPanel({ result, cacheMeta }: Props) {
  const t = useTranslations('admin.license');
  const payload = result.payload;
  if (!payload) return null;

  if (payload.sku === 'air-gapped') {
    return (
      <section
        aria-labelledby="license-revocation-heading"
        className="rounded-lg border border-border bg-bg p-5"
      >
        <h2
          id="license-revocation-heading"
          className="mb-2 text-base font-semibold text-fg"
        >
          {t('revocation.heading')}
        </h2>
        <p className="rounded border border-border bg-bg-subtle px-3 py-2 text-sm text-fg">
          {t('revocation.airGappedPolicy')}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="license-revocation-heading"
      className="rounded-lg border border-border bg-bg p-5"
    >
      <h2
        id="license-revocation-heading"
        className="mb-4 text-base font-semibold text-fg"
      >
        {t('revocation.heading')}
      </h2>

      <dl className="grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-3">
        <DetailRow label={t('revocation.endpoint')}>
          <span className="break-all font-medium">
            {payload.revocationCheckUrl ?? t('revocation.notApplicable')}
          </span>
        </DetailRow>
        <DetailRow label={t('revocation.lastSuccess')}>
          {cacheMeta?.lastSuccessfulRevocationCheckAt ? (
            <span className="block space-y-1">
              <span className="block font-medium">
                {t('time.minutesAgo', {
                  minutes: cacheMeta.lastCheckMinutesAgo ?? 0,
                })}
              </span>
              <span className="block text-xs text-fg-muted">
                <FormattedDate iso={cacheMeta.lastSuccessfulRevocationCheckAt} />
              </span>
            </span>
          ) : (
            <span className="text-fg-muted">{t('time.neverChecked')}</span>
          )}
        </DetailRow>
        <DetailRow label={t('revocation.lastAttempt')}>
          {cacheMeta?.lastRevocationAttemptAt ? (
            <FormattedDate iso={cacheMeta.lastRevocationAttemptAt} />
          ) : (
            <span className="text-fg-muted">{t('time.neverChecked')}</span>
          )}
        </DetailRow>
        <DetailRow label={t('revocation.version')}>
          <span className="font-medium">
            {result.diagnostics.revocationVersion?.toString() ??
              t('revocation.notApplicable')}
          </span>
        </DetailRow>
      </dl>

      <p className="mt-4 text-sm text-fg-muted">
        {result.connectivityStatus === 'fresh' && t('revocation.fresh')}
        {result.connectivityStatus === 'grace' && t('revocation.grace')}
        {result.connectivityStatus === 'grace-expired' &&
          t('revocation.graceExpired')}
        {result.connectivityStatus === 'error' && t('revocation.error')}
        {result.connectivityStatus === 'not-applicable' &&
          t('revocation.notApplicable')}
      </p>
    </section>
  );
}

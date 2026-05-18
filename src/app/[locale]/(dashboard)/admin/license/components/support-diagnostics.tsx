// SupportDiagnostics — 默认关闭的支持诊断区。
//
// 设计意图：
//   - 低频、技术性的签名和 revocation 细节放入 <details>，不干扰日常 operator
//   - 仍保持键盘原生可达，避免自定义 accordion 增加 focus 管理复杂度

'use client';

import { useTranslations } from 'next-intl';
import type { LicenseResult } from '@/lib/license';
import { DetailRow } from './license-details';

interface Props {
  result: LicenseResult;
}

export function SupportDiagnostics({ result }: Props) {
  const t = useTranslations('admin.license');

  return (
    <details className="rounded-lg border border-border bg-bg p-5">
      <summary className="cursor-pointer text-base font-semibold text-fg">
        {t('diagnostics.heading')}
      </summary>

      <dl className="mt-4 grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-3">
        <DetailRow label={t('diagnostics.signingKeyId')}>
          <span className="break-all font-mono text-xs">
            {result.diagnostics.signingKeyId ?? result.payload?.keyId ?? '—'}
          </span>
        </DetailRow>
        <DetailRow label={t('diagnostics.fingerprint')}>
          <span className="break-all font-mono text-xs">
            {result.diagnostics.fingerprint ?? '—'}
          </span>
        </DetailRow>
        <DetailRow label={t('diagnostics.reasonCode')}>
          <span className="break-all font-mono text-xs">
            {result.diagnostics.reasonCode ?? '—'}
          </span>
        </DetailRow>
        <DetailRow label={t('diagnostics.lastError')}>
          <span className="break-all font-mono text-xs">
            {result.diagnostics.lastError ?? '—'}
          </span>
        </DetailRow>
        <DetailRow label={t('revocation.version')}>
          <span className="font-mono text-xs">
            {result.diagnostics.revocationVersion?.toString() ?? '—'}
          </span>
        </DetailRow>
        <DetailRow label={t('diagnostics.schemaVersion')}>
          <span className="font-mono text-xs">
            {result.payload?.schemaVersion ?? '—'}
          </span>
        </DetailRow>
      </dl>
    </details>
  );
}

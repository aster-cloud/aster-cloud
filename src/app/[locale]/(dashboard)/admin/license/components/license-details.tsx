// LicenseDetails — v2 payload 的稳定事实表。
//
// 设计意图：
//   - expired / revoked 也继续显示 payload，让 operator 有足够上下文处理续约或支持单。
//   - 所有关键字段使用 <dl>，copy button 带字段级 aria-label。
//   - 日期使用 ISO 8601，避免 server/client locale 差异导致 hydration mismatch。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LicensePayloadV2 } from '@/lib/license';

interface Props {
  payload: LicensePayloadV2;
  keyPreview: string;
  daysRemaining?: number;
}

export function LicenseDetails({ payload, keyPreview, daysRemaining }: Props) {
  const t = useTranslations('admin.license');

  return (
    <section
      aria-labelledby="license-details-heading"
      className="rounded-lg border border-border bg-bg p-5"
    >
      <h2
        id="license-details-heading"
        className="mb-4 text-base font-semibold text-fg"
      >
        {t('details.heading')}
      </h2>

      <dl className="grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-3">
        <DetailRow label={t('details.customer')}>
          <CopyableValue label={t('details.customer')} value={payload.customer} />
        </DetailRow>
        <DetailRow label={t('details.licenseId')}>
          <CopyableValue label={t('details.licenseId')} value={payload.licenseId} />
        </DetailRow>
        <DetailRow label={t('details.keyPreview')}>
          <span className="font-mono text-xs font-medium">{keyPreview}</span>
        </DetailRow>
        <DetailRow label={t('details.tier')}>
          <span className="font-medium">{payload.tier}</span>
        </DetailRow>
        <DetailRow label={t('details.sku')}>
          <span className="font-medium">{payload.sku}</span>
        </DetailRow>
        <DetailRow label={t('details.licenseTerm')}>
          <span className="font-medium">{payload.licenseTerm}</span>
        </DetailRow>
        <DetailRow label={t('details.seatLimit')}>
          {payload.seatLimit === -1 ? (
            <span className="font-medium">{t('details.seatUnlimited')}</span>
          ) : (
            // 显式用固定 'en-US' locale 格式化数字，避免 server/browser
            // 默认 locale 不一致导致 hydration mismatch（codex 审查 Major-2）。
            // license 是 admin 视图，整数 thousands separator 用 ',' 是企业 SaaS
            // 通用约定，符合中英德三语 admin 习惯。
            <span className="font-medium">
              {new Intl.NumberFormat('en-US').format(payload.seatLimit)}
            </span>
          )}
        </DetailRow>
        <DetailRow label={t('details.issuedAt')}>
          <FormattedDate iso={payload.issuedAt} />
        </DetailRow>
        <DetailRow label={t('details.expiresAt')}>
          <FormattedDate iso={payload.expiresAt} />
        </DetailRow>
        {payload.notBefore && (
          <DetailRow label={t('details.notBefore')}>
            <FormattedDate iso={payload.notBefore} />
          </DetailRow>
        )}
        {typeof daysRemaining === 'number' && (
          <DetailRow label={t('details.daysRemaining')}>
            <span
              className={
                daysRemaining < 0
                  ? 'font-medium text-red-700 dark:text-red-300'
                  : daysRemaining < 14
                    ? 'font-medium text-amber-700 dark:text-amber-300'
                    : 'font-medium text-fg'
              }
            >
              {daysRemaining}
            </span>
          </DetailRow>
        )}
      </dl>

      <hr className="my-4 border-border" />

      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">
          {t('details.features')}
        </h3>
        {payload.features.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('details.noFeatures')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2" role="list">
            {payload.features.map((feature) => (
              <li key={feature}>
                <code className="rounded bg-bg-subtle px-2 py-1 text-xs font-medium text-fg">
                  {feature}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words sm:col-span-2">{children}</dd>
    </>
  );
}

export function FormattedDate({ iso }: { iso: string }) {
  // 用 ISO 字符串呈现而非 toLocaleDateString —— 后者依赖 client locale，
  // 与服务端 server-rendered 文本不一致时会触发 hydration mismatch
  return <time dateTime={iso}>{iso}</time>;
}

export function CopyableValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const t = useTranslations('admin.license');
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard 权限被拒时保持静默；文本仍可手动选中复制
    }
  }

  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span className="min-w-0 break-all font-medium">{value}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t('details.copyValue', { label })}
        className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-fg-muted hover:bg-bg-subtle hover:text-fg focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {copied ? t('details.copied') : t('details.copy')}
      </button>
    </span>
  );
}

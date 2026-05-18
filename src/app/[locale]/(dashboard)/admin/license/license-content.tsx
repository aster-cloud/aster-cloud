// LicenseStatusContent — 客户端组件。
//
// 渲染四种 license 状态：
//   - missing: 显眼引导操作员设置 LICENSE_KEY
//   - malformed: 显示 reasonCode，引导联系销售
//   - expired: 显示过期信息 + 联系销售续约 CTA
//   - active: 显示客户名 / 席位 / 到期日 / tier / features 表格
//
// 设计要点：
//   - 完全可读：所有字段在静态布局中呈现，无需 expand
//   - 复制按钮：feature flag 列表 / customer name 可一键复制（运营常用）
//   - 标签语义化：a11y aria-label，区分状态色（success / warning / danger）
//   - 服务端解析的 result 通过 props 传入；不在客户端再 fetch（避免闪烁）

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LicenseResult, LicensePayload } from '@/lib/license';

interface Props {
  result: LicenseResult;
}

export function LicenseStatusContent({ result }: Props) {
  const t = useTranslations('admin.license');

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
      </header>

      {result.status === 'missing' && <MissingPanel />}
      {result.status === 'malformed' && (
        <MalformedPanel reasonCode={result.reasonCode ?? null} />
      )}
      {result.status === 'expired' && (
        <ExpiredPanel
          payload={result.payload!}
          daysRemaining={result.daysRemaining ?? 0}
        />
      )}
      {result.status === 'active' && (
        <ActivePanel
          payload={result.payload!}
          daysRemaining={result.daysRemaining ?? 0}
          keyPreview={result.keyPreview}
        />
      )}

      {/* 显著提示：当前实现仅做格式解析，没有密码学签名校验。任何
          有权访问 LICENSE_KEY 的人（包括 operator 自己）都可以伪造
          payload。signature verification PR 落地前 hasLicenseFeature
          不应用于授权决策。 */}
      {result.verification === 'unsigned' &&
        (result.status === 'active' || result.status === 'expired') && (
          <UnsignedVerificationNotice />
        )}
    </div>
  );
}

function UnsignedVerificationNotice() {
  const t = useTranslations('admin.license');
  return (
    <section
      role="note"
      aria-labelledby="license-unsigned-heading"
      className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-4 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-200"
    >
      <h2
        id="license-unsigned-heading"
        className="text-sm font-semibold"
      >
        {t('verification.unsignedTitle')}
      </h2>
      <p className="mt-1 text-xs">
        {t('verification.unsignedBody')}
      </p>
    </section>
  );
}

// ─── Status panels ───────────────────────────────────────────────────

function MissingPanel() {
  const t = useTranslations('admin.license');
  return (
    <StatusBanner tone="warning" title={t('missing.title')}>
      <p className="text-sm">{t('missing.body')}</p>
      <p className="mt-2 text-xs text-fg-muted">
        <code className="rounded bg-bg-subtle px-1 py-0.5">LICENSE_KEY</code>
      </p>
    </StatusBanner>
  );
}

function MalformedPanel({ reasonCode }: { reasonCode: string | null }) {
  const t = useTranslations('admin.license');
  const reason = reasonCode
    ? t(`malformed.reason.${reasonCode}` as 'malformed.reason.env-missing')
    : t('malformed.body');
  return (
    <StatusBanner tone="danger" title={t('malformed.title')}>
      <p className="text-sm">{reason}</p>
      <p className="mt-2 text-xs text-fg-muted">{t('malformed.contactSales')}</p>
    </StatusBanner>
  );
}

function ExpiredPanel({
  payload,
  daysRemaining,
}: {
  payload: LicensePayload;
  daysRemaining: number;
}) {
  const t = useTranslations('admin.license');
  const daysAgo = Math.abs(daysRemaining);
  return (
    <>
      <StatusBanner tone="danger" title={t('expired.title')}>
        <p className="text-sm">
          {t('expired.body', { customer: payload.customer, days: daysAgo })}
        </p>
        <p className="mt-2 text-xs text-fg-muted">{t('expired.contactSales')}</p>
      </StatusBanner>
      <LicenseDetails payload={payload} daysRemaining={daysRemaining} />
    </>
  );
}

function ActivePanel({
  payload,
  daysRemaining,
  keyPreview,
}: {
  payload: LicensePayload;
  daysRemaining: number;
  keyPreview: string;
}) {
  const t = useTranslations('admin.license');
  // < 30 days: 视觉警告
  const tone = daysRemaining < 30 ? 'warning' : 'success';
  return (
    <>
      <StatusBanner
        tone={tone}
        title={
          tone === 'warning'
            ? t('active.expiringSoonTitle', { days: daysRemaining })
            : t('active.title')
        }
      >
        <p className="text-sm">
          {t('active.body', {
            customer: payload.customer,
            days: daysRemaining,
          })}
        </p>
        <p className="mt-2 font-mono text-xs text-fg-muted">{keyPreview}</p>
      </StatusBanner>
      <LicenseDetails payload={payload} daysRemaining={daysRemaining} />
    </>
  );
}

// ─── Shared subcomponents ────────────────────────────────────────────

function StatusBanner({
  tone,
  title,
  children,
}: {
  tone: 'success' | 'warning' | 'danger';
  title: string;
  children: React.ReactNode;
}) {
  const toneClasses = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200',
    warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200',
    danger: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200',
  }[tone];

  return (
    <section
      role="status"
      aria-live="polite"
      className={`rounded-lg border p-4 ${toneClasses}`}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function LicenseDetails({
  payload,
  daysRemaining,
}: {
  payload: LicensePayload;
  daysRemaining: number;
}) {
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
          <CopyableValue value={payload.customer} />
        </DetailRow>
        <DetailRow label={t('details.tier')}>
          <span className="font-medium capitalize">{payload.tier}</span>
        </DetailRow>
        <DetailRow label={t('details.seatLimit')}>
          {payload.seatLimit === -1 ? (
            <span className="font-medium">{t('details.seatUnlimited')}</span>
          ) : (
            <span className="font-medium">
              {payload.seatLimit.toLocaleString()}
            </span>
          )}
        </DetailRow>
        <DetailRow label={t('details.issuedAt')}>
          <FormattedDate iso={payload.issuedAt} />
        </DetailRow>
        <DetailRow label={t('details.expiresAt')}>
          <FormattedDate iso={payload.expiresAt} />
        </DetailRow>
        <DetailRow label={t('details.daysRemaining')}>
          <span
            className={
              daysRemaining < 0
                ? 'font-medium text-red-700 dark:text-red-300'
                : daysRemaining < 30
                  ? 'font-medium text-amber-700 dark:text-amber-300'
                  : 'font-medium text-fg'
            }
          >
            {daysRemaining}
          </span>
        </DetailRow>
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
            {payload.features.map((f) => (
              <li key={f}>
                <code className="rounded bg-bg-subtle px-2 py-1 text-xs font-medium text-fg">
                  {f}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="sm:col-span-2">{children}</dd>
    </>
  );
}

function FormattedDate({ iso }: { iso: string }) {
  // 用 ISO 字符串呈现而非 toLocaleDateString —— 后者依赖 client locale，
  // 与服务端的 server-rendered 文本不一致时会触发 hydration mismatch。
  // license 是 admin / 合规视图，机器可读的 ISO 8601 比本地化日期更安全。
  return <time dateTime={iso}>{iso.split('T')[0]}</time>;
}

function CopyableValue({ value }: { value: string }) {
  const t = useTranslations('admin.license');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 浏览器拒绝 clipboard API（http context / 权限拒）— 静默忽略；
      // 用户手动选中文本复制亦可。
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-medium">{value}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={t('details.copyValue', { label: value })}
        className="rounded border border-border px-1.5 py-0.5 text-xs text-fg-muted hover:bg-bg-subtle hover:text-fg focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {copied ? t('details.copied') : t('details.copy')}
      </button>
    </span>
  );
}

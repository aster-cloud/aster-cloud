// OperatorActions — operator 可执行动作。
//
// 设计意图：
//   - Refresh now 只对 standard SKU 显示；air-gapped 是产品策略不是网络故障
//   - 手动刷新成功后 router.refresh()，由 RSC 重新读取 verifier/cache 状态
//   - 下载 diagnostics 是本地 bundle stub，便于支持单附件，不引入新 endpoint

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Mail, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { LicenseResult } from '@/lib/license';
import type { LicenseCacheMeta } from '../license-content';

interface Props {
  result: LicenseResult;
  cacheMeta?: LicenseCacheMeta | null;
  /**
   * SaaS-hosted renewal portal URL passed in from the server page.
   * undefined → fall back to mailto (sales-managed renewal).
   * Set via NEXT_PUBLIC_LICENSE_RENEWAL_PORTAL_URL env on the on-prem
   * deployment; the email contains the token the customer pastes.
   */
  renewalPortalBaseUrl?: string;
}

export function OperatorActions({ result, cacheMeta, renewalPortalBaseUrl }: Props) {
  const t = useTranslations('admin.license');
  const router = useRouter();
  const [refreshState, setRefreshState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');

  const canRefresh = result.payload?.sku === 'standard';
  const showRenewal =
    result.displayStatus === 'verified-expiring-soon' ||
    result.displayStatus === 'verified-expired';

  async function refreshRevocation() {
    setRefreshState('loading');
    try {
      const response = await fetch('/api/admin/license/refresh', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`refresh-failed-${response.status}`);
      setRefreshState('success');
      router.refresh();
    } catch {
      setRefreshState('error');
    }
  }

  function downloadDiagnostics() {
    const bundle = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        result,
        cacheMeta,
      },
      // bigint 不能 JSON.stringify，转 string
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
    const blob = new Blob([bundle], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'aster-license-diagnostics.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      aria-labelledby="license-actions-heading"
      className="rounded-lg border border-border bg-bg p-5"
    >
      <h2
        id="license-actions-heading"
        className="mb-4 text-base font-semibold text-fg"
      >
        {t('actions.heading')}
      </h2>

      <div className="flex flex-wrap gap-3">
        {canRefresh && (
          <button
            type="button"
            onClick={refreshRevocation}
            disabled={refreshState === 'loading'}
            className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {refreshState === 'loading'
              ? t('actions.refreshing')
              : t('actions.refresh')}
          </button>
        )}

        {showRenewal && (
          // 优先走 SaaS-hosted self-serve portal（env 配置后 ops 在邮件里
          // 拿到带 token 的链接，admin 上点 "Renew now" 跳到那个 URL）。
          // 未配置则回退到 mailto（销售管 renewal 的旧流程）。
          renewalPortalBaseUrl ? (
            <a
              href={renewalPortalBaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border border-border bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Mail aria-hidden="true" className="h-4 w-4" />
              {t('actions.renewNow')}
            </a>
          ) : (
            <a
              href="mailto:sales@aster-lang.cloud?subject=Aster%20license%20renewal"
              className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Mail aria-hidden="true" className="h-4 w-4" />
              {t('actions.contactRenewal')}
            </a>
          )
        )}

        <button
          type="button"
          onClick={downloadDiagnostics}
          className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          {t('actions.downloadDiagnostics')}
        </button>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm text-fg-muted">
        {refreshState === 'success' && t('actions.refreshSuccess')}
        {refreshState === 'error' && t('actions.refreshError')}
      </p>
    </section>
  );
}

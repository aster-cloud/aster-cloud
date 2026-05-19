// LicenseStatusContent — v2 license 状态页编排层。
//
// 设计意图：
//   - 页面顶部永远只有一个 primary banner，避免 operator 被多重告警打断判断
//   - trust / entitlement / connectivity 的复杂组合由 server-side verifier
//     合成为 displayStatus；客户端只按 display model 渲染
//   - 详情、撤销状态、操作、诊断分成独立 panel，保持焦点顺序稳定：
//     banner → details → revocation → actions → diagnostics

'use client';

import { useTranslations } from 'next-intl';
import type { LicenseResult } from '@/lib/license';
import { LicenseStatusSummary } from './components/license-status-summary';
import { StatusAdvisories } from './components/status-advisories';
import { LicenseDetails } from './components/license-details';
import { RevocationStatusPanel } from './components/revocation-status-panel';
import { OperatorActions } from './components/operator-actions';
import { SupportDiagnostics } from './components/support-diagnostics';

export interface LicenseCacheMeta {
  lastSuccessfulRevocationCheckAt?: string;
  lastRevocationAttemptAt?: string;
  /** 上次成功检查距 now 的分钟数；前端避免做时钟运算导致 hydration mismatch */
  lastCheckMinutesAgo?: number;
  graceEndedAt?: string;
}

interface Props {
  result: LicenseResult;
  cacheMeta?: LicenseCacheMeta | null;
  /** SaaS renewal portal URL (per-deployment env). undefined → mailto fallback. */
  renewalPortalBaseUrl?: string;
}

export function LicenseStatusContent({
  result,
  cacheMeta = null,
  renewalPortalBaseUrl,
}: Props) {
  const t = useTranslations('admin.license');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
      </header>

      <LicenseStatusSummary result={result} cacheMeta={cacheMeta} />
      <StatusAdvisories result={result} cacheMeta={cacheMeta} />
      {result.payload && (
        <LicenseDetails
          payload={result.payload}
          keyPreview={result.keyPreview}
          daysRemaining={result.daysRemaining}
        />
      )}
      <RevocationStatusPanel result={result} cacheMeta={cacheMeta} />
      <OperatorActions
        result={result}
        cacheMeta={cacheMeta}
        renewalPortalBaseUrl={renewalPortalBaseUrl}
      />
      <SupportDiagnostics result={result} />
    </div>
  );
}

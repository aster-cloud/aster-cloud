// CurrentPublicationCard — signed revocation manifest 状态。
//
// 设计意图：
//   - manifest version / validity 是 auditor 关心的事实，使用 <dl> 保持可扫描
//   - republish 是高影响操作，但不会直接新增 revocation；用 inline live region 反馈

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CurrentPublication } from '../revocation-content';
import { DetailRow, FormattedDate } from '../../license/components/license-details';

export function CurrentPublicationCard({
  publication,
}: {
  publication: CurrentPublication | null;
}) {
  const t = useTranslations('admin.licenseRevoke');
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle',
  );

  async function republish() {
    setState('loading');
    try {
      const response = await fetch('/api/admin/license-revoke/publish', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('republish-failed');
      setState('success');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  return (
    <section
      aria-labelledby="current-publication-heading"
      className="rounded-lg border border-border bg-bg p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="current-publication-heading"
            className="text-base font-semibold text-fg"
          >
            {t('currentPublication.heading')}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            {publication
              ? t('currentPublication.revokedCount', {
                  count: publication.revokedCount,
                })
              : t('currentPublication.unavailable')}
          </p>
        </div>
        <button
          type="button"
          onClick={republish}
          disabled={state === 'loading'}
          className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          {state === 'loading'
            ? t('currentPublication.republishing')
            : t('currentPublication.republish')}
        </button>
      </div>

      {publication && (
        <dl className="mt-4 grid grid-cols-1 gap-y-3 text-sm sm:grid-cols-3">
          <DetailRow label={t('currentPublication.version')}>
            <span className="font-mono text-xs font-medium">{publication.version}</span>
          </DetailRow>
          <DetailRow label={t('currentPublication.publishedAt')}>
            <FormattedDate iso={publication.publishedAt} />
          </DetailRow>
          <DetailRow label={t('currentPublication.validUntil')}>
            <FormattedDate iso={publication.validUntil} />
          </DetailRow>
        </dl>
      )}

      <p aria-live="polite" className="mt-3 min-h-5 text-sm text-fg-muted">
        {state === 'success' && t('currentPublication.republishSuccess')}
        {state === 'error' && t('currentPublication.republishError')}
      </p>
    </section>
  );
}

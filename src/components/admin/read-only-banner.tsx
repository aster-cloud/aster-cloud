// ReadOnlyBanner — on-prem license soft-degradation 全局提示。
//
// 设计意图：
//   - read-only gate 影响所有 admin write 操作，必须出现在 admin chrome 之上
//   - role="alert" + strong-warning 色阶，明确这是可恢复的降级状态，不是 SaaS 故障
//   - server component 直接读 admin.readOnly 翻译，避免客户端 env / gate 漂移
//   - "View license status" 链接到 /admin/license 让 operator 立即看到详情 + actions

import { AlertOctagon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export type ReadOnlyReason =
  | 'grace-expired'
  | 'revoked'
  | 'expired'
  | 'malformed'
  | 'binding-mismatch'
  | 'missing'
  | 'clock-rollback';

export async function ReadOnlyBanner({ reason }: { reason: ReadOnlyReason }) {
  const t = await getTranslations('admin.readOnly');

  return (
    // codex 审查 Major-2：persistent state 用 region/labelledby 而非 assertive
    // alert（避免屏幕阅读器在每次 admin 页面导航时反复打断 announcement）
    <section
      role="region"
      aria-labelledby="license-readonly-banner-heading"
      className="border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 gap-3">
          <AlertOctagon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2
              id="license-readonly-banner-heading"
              className="text-sm font-semibold uppercase tracking-wide"
            >
              {t('heading')}
            </h2>
            <p className="mt-1 text-sm font-medium">{t('subheading')}</p>
            <p className="mt-1 text-sm">{t(`reason.${reason}`)}</p>
          </div>
        </div>
        <Link
          href="/admin/license"
          className="shrink-0 rounded border border-amber-500/50 px-3 py-1.5 text-sm font-medium hover:bg-amber-200/60 focus:outline-none focus:ring-2 focus:ring-amber-700/40 dark:hover:bg-amber-800/40"
        >
          {t('viewLicense')}
        </Link>
      </div>
    </section>
  );
}

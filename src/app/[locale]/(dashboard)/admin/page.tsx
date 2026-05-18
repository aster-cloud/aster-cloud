// /admin —— admin 概览索引页。
//
// 列出所有 admin 子工具入口，按 deployment-mode 过滤可见性。
// admin 权限闸门由 admin/layout.tsx 守门，本页不再重复检查。
//
// 设计要点：
//   - 卡片格栅：每个 admin 工具一张卡，链接到对应子路由
//   - "Coming Soon" 徽章：未实施的工具（license / sso）卡片可见但不可点
//     —— 让操作员知道未来会有，且明白当前不可用
//   - mode 决定可见卡片：CAN_RISKTIER / CAN_LICENSE / CAN_SSO 编译期常量

import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import {
  CAN_RISKTIER,
  CAN_LICENSE,
  CAN_SSO,
} from '@/lib/deployment-mode';

type Props = {
  params: Promise<{ locale: string }>;
};

export const dynamic = 'force-dynamic';

type OverviewCard = {
  href: string;
  /** i18n key under `admin.overview.*Card` */
  cardKey:
    | 'aiBreakerCard'
    | 'riskTierCard'
    | 'licenseCard'
    | 'ssoCard';
  show: boolean;
  /** true → 卡片显示 "Coming soon" 徽章 + 禁用链接 */
  comingSoon: boolean;
};

const CARDS: ReadonlyArray<OverviewCard> = [
  {
    href: '/admin/ai-circuit-breaker',
    cardKey: 'aiBreakerCard',
    show: true,
    comingSoon: false,
  },
  {
    href: '/admin/risk-tier',
    cardKey: 'riskTierCard',
    show: CAN_RISKTIER,
    comingSoon: false,
  },
  {
    href: '/admin/license',
    cardKey: 'licenseCard',
    show: CAN_LICENSE,
    comingSoon: true, // PR-8 之后改 false
  },
  {
    href: '/admin/sso',
    cardKey: 'ssoCard',
    show: CAN_SSO,
    comingSoon: true,
  },
];

export default async function AdminOverviewPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('admin.overview');
  const cards = CARDS.filter((c) => c.show);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('subtitle')}</p>
      </header>

      <section aria-labelledby="admin-overview-tools-heading">
        <h2
          id="admin-overview-tools-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-muted"
        >
          {t('cardsHeading')}
        </h2>
        <ul
          role="list"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {cards.map((card) => (
            <OverviewCardItem
              key={card.href}
              href={card.href}
              title={t(`${card.cardKey}.title`)}
              description={t(`${card.cardKey}.description`)}
              cta={t(`${card.cardKey}.cta`)}
              comingSoonLabel={
                card.comingSoon
                  ? t(`${card.cardKey}.comingSoon` as 'licenseCard.comingSoon')
                  : null
              }
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function OverviewCardItem({
  href,
  title,
  description,
  cta,
  comingSoonLabel,
}: {
  href: string;
  title: string;
  description: string;
  cta: string;
  comingSoonLabel: string | null;
}) {
  const disabled = comingSoonLabel != null;

  // 用 <li> 包 <Link> 让 role="list" 的 grid 项目语义正确；
  // 禁用状态用 aria-disabled 而不是删 href，保持视觉一致
  return (
    <li className="h-full">
      <article
        className={[
          'flex h-full flex-col rounded-lg border border-border bg-bg p-5 transition-shadow',
          disabled
            ? 'opacity-70'
            : 'hover:shadow-md focus-within:shadow-md',
        ].join(' ')}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-fg">{title}</h3>
          {comingSoonLabel && (
            <span className="inline-flex items-center rounded bg-bg-subtle px-2 py-0.5 text-xs font-medium text-fg-muted">
              {comingSoonLabel}
            </span>
          )}
        </div>
        <p className="text-sm text-fg-muted">{description}</p>
        <div className="mt-4 pt-4 border-t border-border text-sm">
          {disabled ? (
            <span
              aria-disabled="true"
              className="text-fg-muted"
            >
              {cta}
            </span>
          ) : (
            <Link
              href={href}
              className="font-medium text-primary hover:underline focus:underline focus:outline-none"
            >
              {cta} →
            </Link>
          )}
        </div>
      </article>
    </li>
  );
}

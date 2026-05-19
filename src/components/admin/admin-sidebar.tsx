// Admin 子壳侧边栏：按 deployment-mode 过滤导航项。
//
// 设计要点：
//   - 数据驱动的 NAV_ITEMS 数组 + `show` 编译期常量过滤；不在调用点写 if-else
//     避免后续维护漂移
//   - 模式专属页（risk-tier=SaaS, license/sso=on-prem）自动按 build 时
//     CAN_* 常量决定是否渲染入口
//   - active route 高亮 + aria-current="page"（屏幕阅读器友好）
//   - 键盘导航：完全依赖原生 <a> tab 顺序，不需要额外 tabIndex
//   - 视觉：左侧 240px 固定宽栏 + 与主导航视觉区隔（border-r + bg-bg）
//
// 路由匹配：参考 src/components/dashboard-nav.tsx 的 isActive 实现，
// 剥离 locale 前缀后做精确 / 前缀匹配。/admin 索引页用精确匹配避免
// 永远高亮；子页用前缀匹配以支持详情子路由（如 /admin/risk-tier/:userId）。

'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  CAN_RISKTIER,
  CAN_LICENSE,
  CAN_SSO,
  IS_SAAS,
} from '@/lib/deployment-mode';

type AdminNavItem = {
  href: string;
  /** i18n key under `admin.nav.*` */
  labelKey:
    | 'overview'
    | 'aiBreaker'
    | 'riskTier'
    | 'license'
    | 'licenseRevoke'
    | 'issuedLicenses'
    | 'sso';
  /** Build-time visibility flag. Filter happens at module top — false items
   *  are dropped from the rendered <ul> entirely (no display:none games). */
  show: boolean;
  /** 索引页用精确匹配；子页用前缀匹配（支持 /admin/risk-tier/:id 子路由）。 */
  matchStrategy: 'exact' | 'prefix';
};

// Future entries (/admin/billing, /admin/audit-log) added here as the
// corresponding PRs land. Keep the list ordered by frequency of use,
// not alphabetically.
const ADMIN_NAV_ITEMS: ReadonlyArray<AdminNavItem> = [
  { href: '/admin', labelKey: 'overview', show: true, matchStrategy: 'exact' },
  {
    href: '/admin/ai-circuit-breaker',
    labelKey: 'aiBreaker',
    show: true, // 两种模式都有
    matchStrategy: 'prefix',
  },
  {
    href: '/admin/risk-tier',
    labelKey: 'riskTier',
    show: CAN_RISKTIER, // SaaS only
    matchStrategy: 'prefix',
  },
  // TODO(PR-4): 加 /admin/billing 入口；新条目用
  // `show: CAN_BILLING`（从 @/lib/deployment-mode 引入），同时
  // 在 messages/*.json 的 admin.nav.* 增加 billing 翻译键。
  {
    href: '/admin/license',
    labelKey: 'license',
    show: CAN_LICENSE, // on-prem only — PR-8 添加占位页
    matchStrategy: 'prefix',
  },
  {
    href: '/admin/license-revoke',
    labelKey: 'licenseRevoke',
    show: IS_SAAS, // SaaS only — Aster ops 撤销客户 license
    matchStrategy: 'prefix',
  },
  {
    href: '/admin/issued-licenses',
    labelKey: 'issuedLicenses',
    show: IS_SAAS, // SaaS only — Aster ops 查看 license 全生命周期
    matchStrategy: 'prefix',
  },
  {
    href: '/admin/sso',
    labelKey: 'sso',
    show: CAN_SSO, // on-prem only — PR-8 添加占位页
    matchStrategy: 'prefix',
  },
];

function stripLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '');
}

function isActive(
  pathname: string,
  href: string,
  strategy: AdminNavItem['matchStrategy'],
): boolean {
  const stripped = stripLocale(pathname) || '/';
  if (strategy === 'exact') return stripped === href;
  return stripped === href || stripped.startsWith(`${href}/`);
}

export function AdminSidebar() {
  const pathname = usePathname();
  const t = useTranslations('admin.nav');
  const items = ADMIN_NAV_ITEMS.filter((i) => i.show);

  return (
    <nav
      aria-label={t('sidebarLabel')}
      className="hidden md:block w-60 shrink-0 border-r border-border bg-bg"
    >
      <ul className="flex flex-col gap-1 p-3" role="list">
        {items.map((item) => {
          const active = isActive(pathname, item.href, item.matchStrategy);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-fg-muted hover:bg-bg-subtle hover:text-fg',
                ].join(' ')}
              >
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

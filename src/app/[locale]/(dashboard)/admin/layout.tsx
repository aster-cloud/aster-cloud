// /admin/* 专属子壳：在 dashboard layout 之上叠加一层 admin 上下文
//
// 设计要点：
//   - **权限闸门**：admin 判定不通过 → notFound()（与 /admin/risk-tier、
//     /admin/ai-circuit-breaker 现有行为一致；不暴露页面存在）。当前
//     两个叶子页本身也各自跑 admin 检查 — 这是冗余但更安全的纵深防御，
//     PR-3 不去除（避免本布局缺失时叶子页变 public 的退化路径）。
//   - **视觉差异化**：红色 "ADMIN CONSOLE" 徽章 + 部署模式标识，让操作员
//     在跨权限操作时清晰意识到当前所处的上下文，降低误操作风险
//   - **左侧子导航**：由 AdminSidebar 渲染；按 deployment-mode 过滤
//   - **i18n**：所有可见文案来自 next-intl，en/zh/de 三语完整
//   - **mode 来源**：服务端用 IS_SAAS 编译期常量（避免客户端组件读 env）

import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isAdminFromSession } from '@/lib/admin-auth';
import { IS_SAAS } from '@/lib/deployment-mode';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const admin = await isAdminFromSession();
  if (!admin) {
    notFound();
  }

  const t = await getTranslations('admin.console');
  const modeLabel = IS_SAAS ? t('modeSaas') : t('modeOnPrem');

  // 注意：父 dashboard layout 把内容包裹在 max-w-7xl mx-auto py-6 px-* 容器里。
  // 这里的负 margin 只能抵消 padding，**无法**突破 max-w-7xl 宽度上限 ——
  // admin 壳仍然被限制在 7xl 之内。当前接受这个约束（admin 工具表格类内容
  // 7xl 足够宽）；如果未来要做真正的 full-bleed admin 控制台，需重构父
  // dashboard layout（拆 route group 或加 full-bleed 变体），本 PR 范围外。
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 flex min-h-[calc(100vh-4rem)] flex-col">
      {/* 顶部 admin chrome 条：红色 badge + 模式标识 + 返回链接 */}
      <header
        role="banner"
        aria-label={t('badge')}
        className="border-b border-border bg-bg-subtle"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-red-900 dark:bg-red-900/40 dark:text-red-200"
              aria-label={t('badge')}
            >
              {t('badge')}
            </span>
            <span className="text-xs text-fg-muted">
              <span className="font-medium text-fg">{t('modeLabel')}:</span>{' '}
              {modeLabel}
            </span>
            <span className="hidden text-xs text-fg-muted sm:inline">
              · {t('scope')}
            </span>
          </div>
          <Link
            href="/dashboard"
            className="text-xs text-primary hover:underline focus:underline focus:outline-none"
          >
            ← {t('returnToDashboard')}
          </Link>
        </div>
      </header>

      <div className="flex flex-1">
        <AdminSidebar />
        <main
          id="admin-main"
          tabIndex={-1}
          className="flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

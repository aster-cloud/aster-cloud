import { Link } from '@/i18n/navigation';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, users } from '@/lib/prisma';
import { ensureSchemaApplied } from '@/lib/db-bootstrap';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/language-switcher';
import {
  DashboardNavClient,
  UserDropdown,
} from '@/components/dashboard-nav';
import { CommandPalette } from '@/components/dashboard/command-palette';
import { buildCommands } from '@/components/dashboard/command-palette-commands';
import { ThemeToggle } from '@/components/theme-toggle';
import { getSession } from '@/lib/auth';
import { isAdminFromSession } from '@/lib/admin-auth';
import { getEffectiveRole, canAccess } from '@/lib/effective-role';
import { defaultLocale } from '@/i18n/config';

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Next.js 15 passes [locale] via params here — match the parent layout
  // pattern (src/app/[locale]/layout.tsx) instead of calling getLocale()
  // from next-intl/server. The latter requires the same request-scoped
  // context the parent layout has already established, but on OpenNext-on-
  // Cloudflare it can throw at deploy time when the platform-proxy preflight
  // tries to resolve the locale without a full request lifecycle.
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const routePrefix = locale === defaultLocale ? '' : `/${locale}`;

  // Run boot-time DB patches + admin seed on first request after a
  // cold start. Idempotent + advisory-locked; subsequent calls in
  // the same Worker instance short-circuit via a Promise cache. Awaited
  // here (rather than fire-and-forget) so the mustChangePassword column
  // exists before the redirect-gate below reads it.
  await ensureSchemaApplied();

  const t = await getTranslations('dashboardNav');
  const tSettings = await getTranslations('settings.account');
  const tNav = await getTranslations('nav');
  const tMobile = await getTranslations('dashboardNav.mobile');
  const tAdmin = await getTranslations('admin.riskTier');
  const tAdminCircuit = await getTranslations('admin.aiCircuitBreaker');
  const tCmd = await getTranslations('dashboardNav.commandPalette');
  const tCommon = await getTranslations('common');

  const session = await getSession();
  const userId = session?.user?.id ?? null;

  // Force password rotation on first login for accounts provisioned
  // with a temporary password (admin bootstrap, future invitations).
  // The flag lives on the User row; we check it here so the gate
  // covers every dashboard surface in one place. The change-password
  // page sits OUTSIDE this layout (under (auth)) so the user can
  // reach it while still flagged.
  if (userId) {
    const row = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { mustChangePassword: true },
    });
    if (row?.mustChangePassword) {
      redirect(`/${locale}/onboarding/change-password`);
    }
  }

  const [admin, role] = await Promise.all([
    isAdminFromSession(),
    userId ? getEffectiveRole(userId) : Promise.resolve('owner' as const),
  ]);

  // role-aware nav 过滤：让 viewer 不看到无操作权限的入口。
  // 真实操作授权仍由 API 层 checkTeamPermission 兜底，本过滤仅决定可见性。
  const navItems = [
    { href: '/dashboard', label: t('dashboard') },        // 所有 role
    { href: '/policies', label: t('policies') },           // viewer 只读，更高 role 可写
    ...(canAccess(role, 'member') ? [{ href: '/reports', label: t('reports') }] : []),
    { href: '/teams', label: t('teams') },                 // 所有 role 看自己加入的 team
    ...(canAccess(role, 'member') ? [{ href: '/security', label: t('security') }] : []),
    ...(admin ? [{ href: '/admin/risk-tier', label: tAdmin('title') }] : []),
    ...(admin
      ? [
          {
            href: '/admin/ai-circuit-breaker',
            label: tAdminCircuit('title'),
          },
        ]
      : []),
  ];

  const secondaryItems = [
    // 只让能影响付费的角色（admin/owner）看到 billing 入口
    ...(canAccess(role, 'admin') ? [{ href: '/billing', label: t('billing') }] : []),
    { href: '/settings', label: t('settings') },           // 个人设置所有 role
  ];

  const userMenuLabels = {
    profile: t('userMenu.profile'),
    settings: t('settings'),
    signOut: tSettings('signOut'),
    signingOut: tSettings('signingOut'),
  };

  const mobileMenuLabels = {
    openMenu: tMobile('openMenu'),
    closeMenu: tMobile('closeMenu'),
  };

  return (
    <div className="min-h-screen bg-bg-subtle text-fg">
      {/* Keyboard-only "skip to main content" link — visually hidden
          until focused. Lets screen-reader / keyboard users bypass the
          nav block on every page load. */}
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg focus:shadow-lg"
      >
        {tCommon('skipToContent')}
      </a>
      {/* Top Navigation */}
      <nav className="bg-bg border-b border-border relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/dashboard" className="flex items-center">
                <span className="text-xl font-bold text-primary">{tNav('brand')}</span>
              </Link>
              {/* Desktop nav and Mobile menu (hamburger + mobile nav drawer) */}
              <DashboardNavClient
                navItems={navItems}
                secondaryItems={secondaryItems}
                userMenuLabels={userMenuLabels}
                mobileMenuLabels={mobileMenuLabels}
                userName={session?.user?.name || undefined}
                userEmail={session?.user?.email || undefined}
              />
            </div>
            <div className="flex items-center space-x-3 sm:space-x-4">
              {/* ⌘K command palette — trigger + dialog. Mounted at layout
                  level so the keyboard shortcut is global across every
                  dashboard page. */}
              <CommandPalette
                commands={buildCommands({
                  routePrefix,
                  labels: {
                    dashboard:   t('dashboard'),
                    policies:    t('policies'),
                    newPolicy:   tCmd('newPolicy'),
                    reports:     t('reports'),
                    teams:       t('teams'),
                    security:    t('security'),
                    billing:     t('billing'),
                    settings:    t('settings'),
                    apiKeys:     tCmd('apiKeys'),
                    aiKeys:      tCmd('aiKeys'),
                    aiAssistant: tCmd('aiAssistant'),
                  },
                  // Viewers can still navigate; gating `create` further is a
                  // role-aware concern we can revisit when the palette grows.
                  canCreate:  canAccess(role, 'member'),
                  showBilling: canAccess(role, 'admin'),
                })}
                labels={{
                  placeholder:    tCmd('placeholder'),
                  noResults:      tCmd('noResults'),
                  groupNavigate:  tCmd('groupNavigate'),
                  groupCreate:    tCmd('groupCreate'),
                  groupSettings:  tCmd('groupSettings'),
                  hintOpen:       tCmd('hintOpen'),
                }}
              />
              <div className="hidden sm:flex sm:items-center sm:space-x-4">
                {secondaryItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-sm text-fg-muted hover:text-fg"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
              <ThemeToggle
                labels={{
                  light: tCommon('themeLight'),
                  dark: tCommon('themeDark'),
                  system: tCommon('themeSystem'),
                }}
              />
              <LanguageSwitcher />
              {/* User dropdown with sign out */}
              <UserDropdown
                userMenuLabels={userMenuLabels}
                userName={session?.user?.name || undefined}
                userEmail={session?.user?.email || undefined}
              />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main
        id="dashboard-main"
        tabIndex={-1}
        className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8"
      >
        {children}
      </main>
    </div>
  );
}

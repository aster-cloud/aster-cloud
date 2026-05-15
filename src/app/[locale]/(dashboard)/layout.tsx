import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/language-switcher';
import {
  DashboardNavClient,
  UserDropdown,
} from '@/components/dashboard-nav';
import { getSession } from '@/lib/auth';
import { isAdminFromSession } from '@/lib/admin-auth';
import { getEffectiveRole, canAccess } from '@/lib/effective-role';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations('dashboardNav');
  const tSettings = await getTranslations('settings.account');
  const tNav = await getTranslations('nav');
  const tMobile = await getTranslations('dashboardNav.mobile');
  const tAdmin = await getTranslations('admin.riskTier');

  const session = await getSession();
  const userId = session?.user?.id ?? null;
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
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white border-b border-gray-200 relative">
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
            <div className="flex items-center space-x-4">
              <div className="hidden sm:flex sm:items-center sm:space-x-4">
                {secondaryItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
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
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

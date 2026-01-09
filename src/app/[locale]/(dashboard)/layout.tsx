import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/language-switcher';
import {
  DashboardNavClient,
  UserDropdown,
} from '@/components/dashboard-nav';
import { getSession } from '@/lib/auth';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations('dashboardNav');
  const tSettings = await getTranslations('settings.account');
  const tNav = await getTranslations('nav');
  const tMobile = await getTranslations('dashboardNav.mobile');

  const session = await getSession();

  const navItems = [
    { href: '/dashboard', label: t('dashboard') },
    { href: '/policies', label: t('policies') },
    { href: '/reports', label: t('reports') },
    { href: '/teams', label: t('teams') },
  ];

  const secondaryItems = [
    { href: '/billing', label: t('billing') },
    { href: '/settings', label: t('settings') },
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
                <span className="text-xl font-bold text-indigo-600">{tNav('brand')}</span>
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

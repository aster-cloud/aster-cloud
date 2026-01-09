import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '@/components/language-switcher';
import { DemoProvider, DemoBanner } from '@/components/demo';

export default async function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations('demo');
  const tNav = await getTranslations('nav');

  const navItems = [
    { href: '/demo/dashboard', label: t('nav.dashboard') },
    { href: '/demo/policies', label: t('nav.policies') },
    { href: '/demo/execute', label: t('nav.execute') },
  ];

  return (
    <DemoProvider>
      <div className="min-h-screen bg-gray-50">
        {/* Demo Banner */}
        <DemoBanner />

        {/* Top Navigation */}
        <nav className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex items-center">
                <Link href="/demo" className="flex items-center">
                  <span className="text-xl font-bold text-indigo-600">
                    {tNav('brand')}
                  </span>
                  <span className="ml-2 text-xs font-medium text-amber-600 bg-amber-100 px-2 py-0.5 rounded">
                    DEMO
                  </span>
                </Link>
                <div className="hidden sm:ml-8 sm:flex sm:space-x-6">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <LanguageSwitcher />
                <Link
                  href="/signup"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  {t('signUp')}
                </Link>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          {children}
        </main>

        {/* Demo Footer */}
        <footer className="bg-white border-t border-gray-200 mt-auto">
          <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <p className="text-sm text-gray-500">{t('footerNote')}</p>
              <div className="flex space-x-6">
                <Link
                  href="/"
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  {t('learnMore')}
                </Link>
                <Link
                  href="/signup"
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  {t('startTrial')}
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </DemoProvider>
  );
}

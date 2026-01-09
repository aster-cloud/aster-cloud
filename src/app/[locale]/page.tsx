import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import {
  getCurrencyForLocale,
  formatPrice,
  getProPrice,
  getTeamPerUserPrice,
  getTeamMinUsers,
  PLANS,
} from '@/lib/plans';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <HomeContent locale={locale} />;
}

function HomeContent({ locale }: { locale: string }) {
  const t = useTranslations();
  const currency = getCurrencyForLocale(locale);

  // 价格计算
  const proMonthlyPrice = formatPrice(getProPrice(currency, 'monthly'), currency);
  const teamPerUserPrice = formatPrice(getTeamPerUserPrice(currency, 'monthly'), currency);
  const teamMinUsers = getTeamMinUsers();

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Navigation */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-sm fixed w-full z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center">
              <span className="text-2xl font-bold text-indigo-600">{t('nav.brand')}</span>
            </div>
            <div className="flex items-center space-x-4">
              <LanguageSwitcher />
              <Link
                href="/login"
                className="text-gray-600 hover:text-gray-900 font-medium"
              >
                {t('common.signIn')}
              </Link>
              <Link
                href="/signup"
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors"
              >
                {t('common.startFreeTrial')}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 tracking-tight">
            {t('hero.title')}
            <span className="block text-indigo-600">{t('hero.titleHighlight')}</span>
          </h1>
          <p className="mt-6 text-xl text-gray-600 max-w-3xl mx-auto">
            {t('hero.description')}
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Link
              href="/signup"
              className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold text-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
            >
              {t('common.getStarted')}
            </Link>
            <Link
              href="/login"
              className="bg-white text-gray-700 px-8 py-3 rounded-lg font-semibold text-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              {t('common.viewDemo')}
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-500">
            {t('hero.noCreditCard')}
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            {t('features.title')}
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 - PII Protection */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.piiProtection.title')}</h3>
              <p className="text-gray-600">
                {t('features.piiProtection.description')}
              </p>
            </div>

            {/* Feature 2 - Compliance Reports */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.complianceReports.title')}</h3>
              <p className="text-gray-600">
                {t('features.complianceReports.description')}
              </p>
            </div>

            {/* Feature 3 - Team Collaboration */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.teamCollaboration.title')}</h3>
              <p className="text-gray-600">
                {t('features.teamCollaboration.description')}
              </p>
            </div>

            {/* Feature 4 - Real-time Execution */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.realTimeExecution.title')}</h3>
              <p className="text-gray-600">
                {t('features.realTimeExecution.description')}
              </p>
            </div>

            {/* Feature 5 - API Access */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.apiAccess.title')}</h3>
              <p className="text-gray-600">
                {t('features.apiAccess.description')}
              </p>
            </div>

            {/* Feature 6 - Version History */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.versionHistory.title')}</h3>
              <p className="text-gray-600">
                {t('features.versionHistory.description')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
            {t('pricing.title')}
          </h2>
          <p className="text-center text-gray-600 mb-12">
            {t('pricing.subtitle')}
          </p>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Plan */}
            <div className="p-8 rounded-2xl border border-gray-200 bg-white flex flex-col">
              <h3 className="text-lg font-semibold text-gray-900">{t('billing.plans.names.free')}</h3>
              <div className="mt-4 flex items-baseline">
                <span className="text-4xl font-bold">{formatPrice(0, currency)}</span>
                <span className="ml-1 text-gray-500">{t('pricing.perMonth')}</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-gray-600 flex-1">
                {PLANS.free.featureKeys.map((featureKey) => (
                  <li key={featureKey} className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {t(`billing.plans.features.${featureKey}`)}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="mt-8 block w-full text-center py-2 px-4 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                {t('common.getStarted')}
              </Link>
            </div>

            {/* Pro Plan */}
            <div className="p-8 rounded-2xl border-2 border-indigo-600 bg-white relative shadow-xl flex flex-col">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                {t('billing.mostPopular')}
              </span>
              <h3 className="text-lg font-semibold text-gray-900">{t('billing.plans.names.pro')}</h3>
              <div className="mt-4 flex items-baseline">
                <span className="text-4xl font-bold">{proMonthlyPrice}</span>
                <span className="ml-1 text-gray-500">{t('pricing.perMonth')}</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-gray-600 flex-1">
                {PLANS.pro.featureKeys.map((featureKey) => (
                  <li key={featureKey} className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {t(`billing.plans.features.${featureKey}`)}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="mt-8 block w-full text-center py-2 px-4 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
              >
                {t('common.startFreeTrial')}
              </Link>
            </div>

            {/* Team Plan */}
            <div className="p-8 rounded-2xl border border-gray-200 bg-white flex flex-col">
              <h3 className="text-lg font-semibold text-gray-900">{t('billing.plans.names.team')}</h3>
              <div className="mt-4 flex items-baseline">
                <span className="text-4xl font-bold">{teamPerUserPrice}</span>
                <span className="ml-1 text-gray-500">{t('pricing.perUser')}{t('pricing.perMonth')}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('billing.minUsers', { count: teamMinUsers })}</p>
              <ul className="mt-6 space-y-3 text-sm text-gray-600 flex-1">
                {PLANS.team.featureKeys.map((featureKey) => (
                  <li key={featureKey} className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {t(`billing.plans.features.${featureKey}`)}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className="mt-8 block w-full text-center py-2 px-4 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                {t('common.contactSales')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-indigo-600">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            {t('cta.title')}
          </h2>
          <p className="text-xl text-indigo-100 mb-8">
            {t('cta.description')}
          </p>
          <Link
            href="/signup"
            className="inline-block bg-white text-indigo-600 px-8 py-3 rounded-lg font-semibold text-lg hover:bg-indigo-50 transition-colors"
          >
            {t('common.startFreeTrial')}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-900">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="text-white font-bold text-xl mb-4 md:mb-0">
              {t('nav.brand')}
            </div>
            <div className="flex space-x-6 text-gray-400 text-sm">
              <Link href="/privacy" className="hover:text-white">{t('footer.privacy')}</Link>
              <Link href="/terms" className="hover:text-white">{t('footer.terms')}</Link>
              <a href="https://docs.aster-lang.cloud" target="_blank" rel="noopener noreferrer" className="hover:text-white">{t('footer.documentation')}</a>
              <a href="mailto:support@aster-lang.cloud" className="hover:text-white">{t('footer.support')}</a>
            </div>
          </div>
          <div className="mt-8 text-center text-gray-500 text-sm">
            &copy; {new Date().getFullYear()} {t('nav.brand')}. {t('footer.copyright')}
          </div>
        </div>
      </footer>
    </div>
  );
}

import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import {
  getCurrencyForLocale,
  formatPrice,
  getProPrice,
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 flex flex-col">
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
          <div className="mt-10 flex justify-center">
            <Link
              href="/signup"
              className="bg-indigo-600 text-white px-8 py-3 rounded-lg font-semibold text-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
            >
              {t('common.getStarted')}
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
            {/* Feature 1 — Native-language CNL */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.nativeLanguage.title')}</h3>
              <p className="text-gray-600">
                {t('features.nativeLanguage.description')}
              </p>
            </div>

            {/* Feature 2 — AI drafts, humans approve */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.aiDraftHumanReview.title')}</h3>
              <p className="text-gray-600">
                {t('features.aiDraftHumanReview.description')}
              </p>
            </div>

            {/* Feature 3 — Hash-chained tamper-evident audit */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.hashChainAudit.title')}</h3>
              <p className="text-gray-600">
                {t('features.hashChainAudit.description')}
              </p>
            </div>

            {/* Feature 4 — Dual-engine semantics */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.dualEngineSemantics.title')}</h3>
              <p className="text-gray-600">
                {t('features.dualEngineSemantics.description')}
              </p>
            </div>

            {/* Feature 5 — Multi-language packs */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.multiLanguagePacks.title')}</h3>
              <p className="text-gray-600">
                {t('features.multiLanguagePacks.description')}
              </p>
            </div>

            {/* Feature 6 — Self-host on K3S */}
            <div className="p-6 rounded-xl border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('features.selfHostable.title')}</h3>
              <p className="text-gray-600">
                {t('features.selfHostable.description')}
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

            {/* Enterprise Plan */}
            <div className="p-8 rounded-2xl border border-gray-200 bg-white flex flex-col">
              <h3 className="text-lg font-semibold text-gray-900">{t('billing.plans.names.enterprise')}</h3>
              <div className="mt-4 flex items-baseline">
                <span className="text-2xl font-semibold text-gray-700">{t('common.contactSales')}</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-gray-600 flex-1">
                {PLANS.enterprise.featureKeys.map((featureKey) => (
                  <li key={featureKey} className="flex items-center">
                    <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {t(`billing.plans.features.${featureKey}`)}
                  </li>
                ))}
              </ul>
              <Link
                href="mailto:sales@aster-lang.cloud"
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
      <footer className="py-12 px-4 sm:px-6 lg:px-8 bg-gray-900 mt-auto">
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

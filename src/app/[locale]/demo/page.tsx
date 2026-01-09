import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function DemoLandingPage() {
  const t = await getTranslations('demo');

  const features = [
    {
      icon: '📋',
      titleKey: 'features.policies.title',
      descKey: 'features.policies.description',
    },
    {
      icon: '▶️',
      titleKey: 'features.execute.title',
      descKey: 'features.execute.description',
    },
    {
      icon: '🔒',
      titleKey: 'features.pii.title',
      descKey: 'features.pii.description',
    },
    {
      icon: '📊',
      titleKey: 'features.versions.title',
      descKey: 'features.versions.description',
    },
  ];

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="text-center py-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          {t('landing.title')}
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
          {t('landing.subtitle')}
        </p>
        <div className="flex justify-center gap-4">
          <Link
            href="/demo/dashboard"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            {t('landing.startDemo')}
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            {t('landing.createAccount')}
          </Link>
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((feature, index) => (
          <div
            key={index}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start space-x-4">
              <span className="text-3xl">{feature.icon}</span>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {t(feature.titleKey)}
                </h3>
                <p className="text-gray-600 mt-1">{t(feature.descKey)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Limitations Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-amber-800 mb-2">
          {t('limitations.title')}
        </h3>
        <ul className="text-amber-700 space-y-1 list-disc list-inside">
          <li>{t('limitations.sessionExpiry')}</li>
          <li>{t('limitations.policyLimit')}</li>
          <li>{t('limitations.noApi')}</li>
          <li>{t('limitations.dataCleared')}</li>
        </ul>
        <p className="mt-4 text-amber-800">
          {t('limitations.upgrade')}{' '}
          <Link href="/signup" className="font-medium underline">
            {t('limitations.signUp')}
          </Link>
        </p>
      </div>
    </div>
  );
}

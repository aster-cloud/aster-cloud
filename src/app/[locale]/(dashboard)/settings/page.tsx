'use client';

import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, days: number = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const { data: session } = useSession();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [localeDetection, setLocaleDetection] = useState(false);

  useEffect(() => {
    // Load locale detection preference from cookie
    const saved = getCookie(LOCALE_DETECTION_COOKIE);
    if (saved !== null) {
      setLocaleDetection(saved === 'true');
    }
  }, []);

  const handleLocaleDetectionToggle = () => {
    const newValue = !localeDetection;
    setLocaleDetection(newValue);
    setCookie(LOCALE_DETECTION_COOKIE, String(newValue));
    // Refresh to apply the change
    window.location.reload();
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut({ callbackUrl: '/' });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('subtitle')}
        </p>
      </div>

      {/* API Keys Section */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium leading-6 text-gray-900">{t('apiKeys.title')}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {t('apiKeys.subtitle')}
              </p>
            </div>
            <Link
              href="/settings/api-keys"
              className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              {t('apiKeys.manageKeys')}
            </Link>
          </div>
        </div>
      </div>

      {/* Language Preferences Section */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">{t('language.title')}</h3>
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{t('language.autoDetect')}</p>
                <p className="text-sm text-gray-500">{t('language.autoDetectDesc')}</p>
              </div>
              <button
                onClick={handleLocaleDetectionToggle}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                  localeDetection ? 'bg-indigo-600' : 'bg-gray-200'
                }`}
                role="switch"
                aria-checked={localeDetection}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    localeDetection ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {localeDetection ? t('language.enabled') : t('language.disabled')}
            </p>
          </div>
        </div>
      </div>

      {/* Profile Section */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">{t('profile.title')}</h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('profile.name')}</label>
              <p className="mt-1 text-sm text-gray-900">{session?.user?.name || t('profile.notSet')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('profile.email')}</label>
              <p className="mt-1 text-sm text-gray-900">{session?.user?.email || t('profile.notSet')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('profile.plan')}</label>
              <p className="mt-1 text-sm text-gray-900 capitalize">{session?.user?.plan || 'Free'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Account Actions Section */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">{t('account.title')}</h3>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{t('account.signOut')}</p>
                <p className="text-sm text-gray-500">{t('account.signOutDesc')}</p>
              </div>
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {isLoggingOut ? t('account.signingOut') : t('account.signOut')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-white shadow rounded-lg border border-red-200">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-red-600">{t('dangerZone.title')}</h3>
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{t('dangerZone.deleteAccount')}</p>
                <p className="text-sm text-gray-500">
                  {t('dangerZone.deleteAccountDesc')}
                </p>
              </div>
              <button
                disabled
                className="inline-flex items-center px-4 py-2 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('dangerZone.deleteAccount')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

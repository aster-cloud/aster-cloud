'use client';

import { useDemoSession } from './demo-provider';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';

export function DemoBanner() {
  const { session, limits, loading } = useDemoSession();
  const t = useTranslations('demo');

  if (loading) {
    return (
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="h-5 w-48 bg-amber-200 animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200">
      <div className="max-w-7xl mx-auto px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center space-x-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
              {t('badge')}
            </span>
            <span className="text-sm text-amber-700">
              {t('sessionExpires', { time: session.timeRemaining })}
            </span>
            {limits && (
              <span className="hidden sm:inline text-sm text-amber-600">
                •{' '}
                {t('policiesUsed', {
                  current: limits.policies.current,
                  max: limits.policies.max,
                })}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <Link
              href="/signup"
              className="text-sm font-medium text-amber-700 hover:text-amber-900 underline"
            >
              {t('signUpForFull')}
            </Link>
            <span className="text-amber-300">|</span>
            <Link
              href="/login"
              className="text-sm text-amber-600 hover:text-amber-800"
            >
              {t('alreadyHaveAccount')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

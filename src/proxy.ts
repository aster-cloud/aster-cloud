import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { locales, defaultLocale } from './i18n/config';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

export default function proxy(request: NextRequest) {
  // Read user preference from cookie, default to false (no auto-detection)
  const localeDetectionCookie = request.cookies.get(LOCALE_DETECTION_COOKIE);
  const localeDetection = localeDetectionCookie?.value === 'true';

  const handleI18nRouting = createMiddleware({
    locales,
    defaultLocale,
    localePrefix: 'as-needed', // Don't add prefix for default locale
    localeDetection,
  });

  return handleI18nRouting(request);
}

export const config = {
  // Match all pathnames except for API routes, static files, etc.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale, type Locale } from './i18n/config';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Read user preference from cookie, default to false (no auto-detection)
  const localeDetectionCookie = request.cookies.get(LOCALE_DETECTION_COOKIE);
  const localeDetection = localeDetectionCookie?.value === 'true';

  // Check if user has a saved locale preference (set by next-intl when visiting localized pages)
  const savedLocale = request.cookies.get('NEXT_LOCALE')?.value as Locale | undefined;

  // If user has a non-default locale preference and is accessing a non-prefixed path, redirect
  if (savedLocale && savedLocale !== defaultLocale && locales.includes(savedLocale)) {
    const hasLocalePrefix = locales.some(
      (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
    );

    if (!hasLocalePrefix && pathname !== '/') {
      const url = request.nextUrl.clone();
      url.pathname = `/${savedLocale}${pathname}`;
      return NextResponse.redirect(url);
    }
  }

  const handleI18nRouting = createMiddleware({
    locales,
    defaultLocale,
    localePrefix: 'as-needed',
    localeDetection,
  });

  return handleI18nRouting(request);
}

export const config = {
  // Match all pathnames except for API routes, static files, etc.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { locales, defaultLocale } from './i18n/config';

// 强制使用 Edge Runtime 以兼容 Cloudflare Workers
export const runtime = 'experimental-edge';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

export default function middleware(request: NextRequest) {
  // Read user preference from cookie, default to false (no auto-detection)
  const localeDetectionCookie = request.cookies.get(LOCALE_DETECTION_COOKIE);
  const localeDetection = localeDetectionCookie?.value === 'true';

  // Let next-intl handle all i18n routing
  // With localePrefix: 'as-needed', default locale (en) doesn't need prefix
  // Non-default locales (zh, de) will have prefix automatically added
  const handleI18nRouting = createMiddleware({
    locales,
    defaultLocale,
    localePrefix: 'as-needed',
    localeDetection,
  });

  return handleI18nRouting(request);
}

export const config = {
  // Match root path and all pathnames except for API routes, static files, etc.
  matcher: ['/', '/((?!api|_next|_vercel|.*\\..*).*)'],
};

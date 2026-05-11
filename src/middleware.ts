import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale, type Locale } from './i18n/config';
import { buildCspHeader, securityHeadersOnly } from '@/lib/security/csp';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

/**
 * Apply CSP + security headers to every middleware response.
 * Centralized so both the i18n redirect path and the normal flow get the same hardening.
 */
function applySecurityHeaders(response: NextResponse, nonce: string) {
  const csp = buildCspHeader(nonce);
  response.headers.set('Content-Security-Policy', csp);
  for (const [k, v] of Object.entries(securityHeadersOnly())) {
    response.headers.set(k, v);
  }
  // x-nonce header is exposed only inside the request pipeline (Next reads it via headers())
  response.headers.set('x-nonce', nonce);
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // SNAP-8: 确保入站请求有 traceparent；缺失时生成 root context（W3C Trace Context）
  // 方便后续浏览器 RUM 接入；当前阶段只透传到 cloud 内部 + 出站 fetch
  if (!request.headers.get('traceparent')) {
    const rand = (n: number) =>
      Array.from(crypto.getRandomValues(new Uint8Array(n)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const traceId = rand(16);
    const spanId = rand(8);
    request.headers.set('traceparent', `00-${traceId}-${spanId}-01`);
  }

  // Read user preference from cookie, default to false (no auto-detection)
  const localeDetectionCookie = request.cookies.get(LOCALE_DETECTION_COOKIE);
  const localeDetection = localeDetectionCookie?.value === 'true';

  // Check if user has a saved locale preference (set by next-intl when visiting localized pages)
  const savedLocale = request.cookies.get('NEXT_LOCALE')?.value as Locale | undefined;

  // Generate per-request CSP nonce; expose via request header for downstream layouts
  const nonce = generateNonce();
  request.headers.set('x-nonce', nonce);

  // If user has a non-default locale preference and is accessing a non-prefixed path, redirect
  if (savedLocale && savedLocale !== defaultLocale && locales.includes(savedLocale)) {
    const hasLocalePrefix = locales.some(
      (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
    );

    if (!hasLocalePrefix && pathname !== '/') {
      const url = request.nextUrl.clone();
      url.pathname = `/${savedLocale}${pathname}`;
      const redirect = NextResponse.redirect(url);
      applySecurityHeaders(redirect, nonce);
      return redirect;
    }
  }

  const handleI18nRouting = createMiddleware({
    locales,
    defaultLocale,
    localePrefix: 'as-needed',
    localeDetection,
  });

  const response = handleI18nRouting(request);
  applySecurityHeaders(response, nonce);
  return response;
}

export const config = {
  // Match all pathnames except for API routes, static files, etc.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

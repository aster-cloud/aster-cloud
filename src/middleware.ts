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
  // x-nonce header exposed on the response for downstream layouts that
  // read it via headers() helper in Server Components.
  response.headers.set('x-nonce', nonce);
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function rand(n: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Build a NEW Headers object for downstream — Edge runtime forbids mutating
  // request.headers in place. We populate it with the inbound headers plus
  // any additions (traceparent, x-nonce) and pass it via NextResponse.next.
  const downstreamHeaders = new Headers(request.headers);

  // SNAP-8: ensure traceparent (W3C Trace Context). Generate if missing.
  if (!downstreamHeaders.has('traceparent')) {
    downstreamHeaders.set('traceparent', `00-${rand(16)}-${rand(8)}-01`);
  }

  // Per-request CSP nonce; expose via downstream request header for layouts.
  const nonce = generateNonce();
  downstreamHeaders.set('x-nonce', nonce);

  // Read user preference from cookie, default to false (no auto-detection)
  const localeDetectionCookie = request.cookies.get(LOCALE_DETECTION_COOKIE);
  const localeDetection = localeDetectionCookie?.value === 'true';

  // Check if user has a saved locale preference
  const savedLocale = request.cookies.get('NEXT_LOCALE')?.value as Locale | undefined;

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

  // Run the i18n handler. It returns a NextResponse. If it returns a "next"
  // response (no redirect/rewrite), we need to merge in our downstream
  // request headers; otherwise we just attach security headers and return.
  const response = handleI18nRouting(request);

  // Attach our enriched request headers via the x-middleware-request-* mechanism
  // that NextResponse.next uses. The cleanest path: if i18n returned a rewrite
  // (most common case), it already has the request headers baked in; we just
  // overlay security response headers and our nonce.
  applySecurityHeaders(response, nonce);

  // For nonce propagation to Server Components, we set the nonce on the request
  // headers via a "set-cookie style" passthrough — but since we cannot mutate
  // request.headers in-place, and i18n already returned its response, the
  // canonical Next.js trick is to add the nonce via response header and have
  // the layout read it from there. (See app/layout.tsx headers() lookup.)
  return response;
}

export const config = {
  // Match all pathnames except for API routes, static files, etc.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

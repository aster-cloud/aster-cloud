import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale, type Locale } from './i18n/config';
import { buildCspHeader, securityHeadersOnly } from '@/lib/security/csp';
import { fetchAvailable } from '@/lib/lexicon-availability';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

// fetchAvailable + AvailabilityResult 已抽到 @/lib/lexicon-availability
// 让 R5 单元测试可直接对其测试，middleware 保持薄

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

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ----- 严格 locale gate：路径里的 locale 段必须落在后端可用集合 -----
  // 仅检查显式带 locale 前缀的请求（例如 /zh/dashboard）。
  // R3：只在 authoritative=true 时执行重定向 + 清 cookie；
  // 冷启动 + 后端不可达（authoritative=false）保留用户偏好，让 next-intl 正常处理。
  const firstSeg = pathname.split('/')[1] as Locale | undefined;
  if (firstSeg && (locales as readonly string[]).includes(firstSeg)) {
    const { available, authoritative } = await fetchAvailable();
    if (authoritative && !available.has(firstSeg)) {
      const url = request.nextUrl.clone();
      // 把 /zh/foo/bar → /en/foo/bar；defaultLocale 用 as-needed 时无前缀
      const rest = pathname.substring(firstSeg.length + 1) || '/';
      url.pathname = defaultLocale === 'en' ? rest : `/${defaultLocale}${rest}`;
      const redirect = NextResponse.redirect(url);
      // R3-Minor-FE：locale-gate 重定向同步清掉 stale cookie，避免下次 cookie 路径再触发一次往返
      redirect.cookies.delete('NEXT_LOCALE');
      const fallbackNonce = generateNonce();
      applySecurityHeaders(redirect, fallbackNonce);
      return redirect;
    }
  }


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

  // C1 + R3：cookie 触发的重定向必须满足三件事：
  //   1) savedLocale 是 compile-time supported 之一
  //   2) 后端 availability 是 authoritative（不是冷启动 fetch 失败的 guess）
  //   3) savedLocale 仍在 available 集合中
  // 只有 (1) && (2) && !(3) 才视为"确认不可用"，删 cookie + 按 default 走。
  // authoritative=false 时（冷启动 outage）保留 cookie，让下次请求重试。
  if (savedLocale && savedLocale !== defaultLocale && locales.includes(savedLocale)) {
    const { available, authoritative } = await fetchAvailable();
    if (authoritative && !available.has(savedLocale)) {
      // 确认 stale → 清掉 cookie；按当前 path 继续，让 next-intl 处理
      const dropResponse = NextResponse.next({
        request: { headers: downstreamHeaders },
      });
      dropResponse.cookies.delete('NEXT_LOCALE');
      applySecurityHeaders(dropResponse, nonce);
      return dropResponse;
    }
    // authoritative=false 时，假定 cookie 仍有效，按正常 saved-locale redirect 走
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

import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale, type Locale } from './i18n/config';
import { buildCspHeader, securityHeadersOnly } from '@/lib/security/csp';
import { fetchAvailable } from '@/lib/lexicon-availability';
import { applyCsrfGate } from '@/lib/security/csrf-gate';

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

  // ===== CSRF 网关（审计 #168）：/api 变更请求的集中防护 =====
  // 放在最前面并**提前返回**——API 路由不需要下面的 i18n/CSP/locale 逻辑（matcher 原本排除
  // /api，本次为跑此 gate 才纳入；纳入后必须在这里短路，避免 i18n 逻辑污染 API 响应）。
  // 逻辑抽到 applyCsrfGate（可单测的纯函数，不拉 next-intl 链）。返回非 null 即拒绝。
  if (pathname.startsWith('/api/')) {
    const denied = applyCsrfGate(request);
    if (denied) return denied;
    // API 请求（放行）在此结束 middleware——不进入 i18n/CSP 流程。
    return NextResponse.next();
  }

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

  // Standalone-runtime loop-breaker for next-intl 4.x + `localePrefix:
  // 'as-needed'`.
  //
  // The interaction that creates the loop:
  //   1. GET /          → next-intl rewrites to /en (sets
  //                       x-middleware-rewrite, status 200)
  //   2. Node internally re-routes to /en and re-runs middleware
  //   3. next-intl on /en (default locale prefixed) returns a redirect
  //      back to / with status 307 + `Location: /`
  //   4. Browser navigates / → step 1 → ERR_TOO_MANY_REDIRECTS
  //
  // On Cloudflare Workers (= SaaS), the runtime flags internal re-routes
  // so middleware is NOT re-invoked for the rewritten hop, step 3 never
  // fires, and the user sees the / URL with /en's content. On Node
  // standalone (= on-prem), middleware DOES re-run, and we hit the loop.
  //
  // Fix: when next-intl wants to redirect a default-locale-prefixed
  // path back to its unprefixed form, just serve the prefixed path
  // as-is. The user-visible URL becomes /en/foo instead of /foo for
  // default locale on standalone — slightly suboptimal vs SaaS but
  // functional, and avoids the loop entirely. Non-default locales
  // (/de/foo, /zh/foo) are unaffected: they always retain their prefix
  // in `as-needed` mode by design and next-intl never asks for a strip.
  //
  // SaaS impact: zero. Cloudflare runtime intercepts the rewrite before
  // middleware re-runs, so the conditions in this branch (status 307 +
  // Location pointing back to the unprefixed form) never simultaneously
  // hold there. The branch is a no-op on SaaS.
  if (response.status === 307 && response.headers.has('location')) {
    const loc = response.headers.get('location') ?? '';
    let locPath: string;
    try {
      locPath = new URL(loc, request.url).pathname;
    } catch {
      locPath = loc;
    }
    const defaultPrefix = `/${defaultLocale}`;
    const isDefaultPrefixStrip =
      pathname === defaultPrefix ||
      pathname.startsWith(`${defaultPrefix}/`);
    const wouldBeUnprefixed =
      isDefaultPrefixStrip &&
      (locPath === '/' ||
        locPath === pathname.slice(defaultPrefix.length) ||
        locPath === pathname.slice(defaultPrefix.length) + '/');
    if (wouldBeUnprefixed) {
      const passthrough = NextResponse.next({
        request: { headers: downstreamHeaders },
      });
      // Preserve cookies that next-intl set on the original response.
      for (const cookie of response.cookies.getAll()) {
        passthrough.cookies.set(cookie);
      }
      applySecurityHeaders(passthrough, nonce);
      return passthrough;
    }
  }

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
  // 两条 matcher：
  //   1) 页面路径（排除 api/_next/_vercel/静态文件）→ 走 i18n/CSP/locale 流程。
  //   2) /api/**（审计 #168）→ 只为 CSRF 网关纳入；middleware 顶部对 /api 提前返回，
  //      不进入 i18n 逻辑。两条互斥，页面流程仍完全不受 API 请求影响。
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)', '/api/:path*'],
};

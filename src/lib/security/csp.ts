/**
 * Content Security Policy + adjacent security headers.
 *
 * Phase 3D-1 / 3D-4 hardening — target: securityheaders.com A+.
 *
 * Strategy:
 *   - **CSP nonce-based** for inline scripts/styles (Next.js requires inline runtime)
 *   - **strict-dynamic** lets script-src trust transitively loaded scripts
 *   - **frame-ancestors 'none'** prevents clickjacking
 *   - **report-uri** off until Phase 3E observability lands (avoid noise)
 *
 * Dev / prod differences:
 *   - Dev: 'unsafe-eval' allowed for Next.js HMR
 *   - Prod: strict; no eval
 */

const STRIPE_DOMAINS = [
  'https://js.stripe.com',
  'https://api.stripe.com',
  'https://hooks.stripe.com',
];

const MIXPANEL_DOMAINS = [
  'https://api-js.mixpanel.com',
  'https://api.mixpanel.com',
];

// aster-api 直连域名（AI generate/explain/complete SSE 走客户端 fetch，
// 不经 Next.js server proxy，所以必须在 connect-src 列白）
const ASTER_API_DOMAINS = [
  'https://policy.aster-lang.dev',
];

// Monaco Editor 默认从 jsDelivr 加载 worker/loader/main bundle 和 sourcemap
// （@monaco-editor/react 的运行时行为）。需要在 script/style/connect 三处都列白。
const MONACO_CDN_DOMAINS = [
  'https://cdn.jsdelivr.net',
];

const ALL_TRUSTED_SCRIPT_SRC = [
  ...STRIPE_DOMAINS,
  ...MIXPANEL_DOMAINS,
  ...MONACO_CDN_DOMAINS,
];
const ALL_TRUSTED_CONNECT_SRC = [
  ...STRIPE_DOMAINS,
  ...MIXPANEL_DOMAINS,
  ...ASTER_API_DOMAINS,
  ...MONACO_CDN_DOMAINS,
  // SSE / WebSocket
  "wss:",
];

/**
 * Build the `Content-Security-Policy` header value.
 *
 * @param nonce Per-request nonce (base64) attached to all <script>/<style> tags by Next.js when read via headers().get('x-nonce')
 */
export function buildCspHeader(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
      ...ALL_TRUSTED_SCRIPT_SRC,
    ],
    // style-src 同时有 nonce 时浏览器会忽略 'unsafe-inline'（CSP3 spec）。
    // Monaco editor 动态注入未 nonce 的 <style> 元素 → 被拒。
    // 解法：拆 style-src-elem（管 <style>/<link>，允许 inline + jsDelivr CDN）
    // 与 style-src-attr（管 style="" 行内属性，允许 inline）。
    // 老 style-src 作为不支持 -elem/-attr 浏览器的 fallback。
    'style-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'unsafe-inline'",
      ...MONACO_CDN_DOMAINS,
    ],
    'style-src-elem': [
      "'self'",
      "'unsafe-inline'",
      ...MONACO_CDN_DOMAINS,
    ],
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      ...ALL_TRUSTED_CONNECT_SRC,
      ...(isDev ? ['ws:', 'http://localhost:*'] : []),
    ],
    'frame-src': ["'self'", ...STRIPE_DOMAINS],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length > 0 ? `${key} ${values.join(' ')}` : key))
    .join('; ');
}

/**
 * Additional security headers shipped alongside CSP.
 * Target: A+ on securityheaders.com.
 */
export function securityHeadersOnly(): Record<string, string> {
  return {
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=(self "https://js.stripe.com")',
      'usb=()',
      'interest-cohort=()', // FLoC opt-out
    ].join(', '),
    // Cross-Origin-Opener-Policy + COEP: defense in depth (Spectre / cross-origin isolation)
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'on',
  };
}

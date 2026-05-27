import { safeEnv } from '@/lib/runtime/safe-env';

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

// aster-api 直连域名（AI generate/explain/complete SSE + lexicons stream
// 走客户端 fetch，不经 Next.js server proxy，所以必须在 connect-src 列白）。
//
// On-prem 部署通过 NEXT_PUBLIC_ASTER_POLICY_API_URL 把 aster-api 指向
// 客户内网（e.g. https://policy.internal.example.com 或
// http://localhost:58080 for local dry-run）。CSP allow-list 也必须跟着
// 走，否则浏览器拦掉 fetch — 这是 May 2026 E2E 暴露的 bug 之一。
//
// 数据流：next.config.ts 没有镜像这个 env 到 NEXT_PUBLIC_*（已经是公开
// 前缀的不需要镜像）；server-side CSP 通过 safeEnv 读取 —— middleware import
// 链跨 Node / CF Workers / Edge，裸 process.env 在无 process 全局的 runtime
// 模块加载时即 ReferenceError（codex round 9 发现的盲点）。
function computeAsterApiDomains(): string[] {
  const configured = safeEnv('NEXT_PUBLIC_ASTER_POLICY_API_URL');
  if (!configured) return ['https://policy.aster-lang.dev'];
  try {
    const u = new URL(configured);
    // CSP 只接受 scheme://host[:port]，剥掉 path / trailing slash
    return [`${u.protocol}//${u.host}`];
  } catch {
    // 配置不是合法 URL — 退回默认避免在 boot 时炸；运维会在浏览器看到
    // CORS / connect-src 报错很快意识到。
    return ['https://policy.aster-lang.dev'];
  }
}
const ASTER_API_DOMAINS = computeAsterApiDomains();

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
  const isDev = safeEnv('NODE_ENV') !== 'production';

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

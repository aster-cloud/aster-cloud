/**
 * CSRF defense for aster-cloud cookie-based session endpoints.
 *
 * Phase 3D-2.
 *
 * Strategy:
 *   - Browser → aster-cloud uses NextAuth cookies (HttpOnly, Secure, SameSite=Lax by default)
 *   - We additionally enforce Origin / Referer match on state-changing API requests
 *   - Bearer-token API key calls bypass (no cookie → not CSRF-able)
 *
 * Why not double-submit token?
 *   - Cookie SameSite=Lax already blocks cross-site POST/PUT/DELETE in modern browsers
 *   - Origin check covers the rare edge cases (form submissions, image preload tricks)
 *   - Adding a session-bound token would require refactoring every Server Action;
 *     diminishing returns for the threat model
 *
 * Reference: OWASP CSRF Prevention Cheat Sheet — "SameSite Cookie Attribute" + "Origin Header"
 */

/** Methods that are safe per RFC 7231 — no CSRF risk. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface CsrfCheckOptions {
  /** Trusted origins; defaults to a single allow-list derived from env. */
  allowedOrigins?: string[];
}

/**
 * Check whether a request should be allowed past CSRF guard.
 *
 * Pass-through cases (no CSRF risk):
 *   - Safe HTTP methods
 *   - Bearer-token authenticated requests (Authorization header present)
 *
 * Enforced cases:
 *   - Cookie-authenticated state-changing requests must have Origin or Referer
 *     pointing at an allowed origin.
 */
export function checkCsrf(
  request: Request,
  options: CsrfCheckOptions = {},
): CsrfCheckResult {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return { allowed: true };
  }

  // Bearer-token API key: no cookie → no CSRF risk
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return { allowed: true };
  }

  const allowedOrigins = options.allowedOrigins ?? defaultAllowedOrigins();
  if (allowedOrigins.length === 0) {
    // No allowed origins configured — fail open in dev, fail closed in prod
    if (process.env.NODE_ENV === 'production') {
      return { allowed: false, reason: 'No allowed origins configured (prod requires explicit list)' };
    }
    return { allowed: true };
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (origin) {
    if (allowedOrigins.includes(origin)) {
      return { allowed: true };
    }
    return { allowed: false, reason: `Origin ${origin} not in allow-list` };
  }

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
      if (allowedOrigins.includes(refererOrigin)) {
        return { allowed: true };
      }
      return { allowed: false, reason: `Referer ${refererOrigin} not in allow-list` };
    } catch {
      return { allowed: false, reason: 'Malformed Referer header' };
    }
  }

  return { allowed: false, reason: 'Missing Origin and Referer headers' };
}

function defaultAllowedOrigins(): string[] {
  const envValue = process.env.CSRF_ALLOWED_ORIGINS;
  if (envValue) {
    // 显式列表也补 www/apex 配对（见下），保持与 NEXT_PUBLIC_APP_URL 路径一致的行为。
    return withWwwVariants(
      envValue.split(',').map((o) => o.trim()).filter(Boolean),
    );
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    // 同一站点的 apex 与 www 应互认——用户经 www.<domain> 访问时 Origin 是 www 版本,
    // 但 NEXT_PUBLIC_APP_URL 只配了 apex → 会误判 CSRF 403。补上 www/apex 配对消除该误伤。
    return withWwwVariants([appUrl.replace(/\/$/, '')]);
  }
  // Dev fallbacks (no prod side effect — see fail-closed path above)
  if (process.env.NODE_ENV !== 'production') {
    return [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
    ];
  }
  return [];
}

/**
 * 对每个 origin 补齐 apex↔www 配对：
 *   https://example.com      → + https://www.example.com
 *   https://www.example.com  → + https://example.com
 * 仅对形如 <scheme>://<host>[:port] 的合法 URL 生效;非法/localhost 原样保留。去重。
 */
function withWwwVariants(origins: string[]): string[] {
  const out = new Set<string>();
  for (const o of origins) {
    out.add(o);
    try {
      const u = new URL(o);
      const host = u.hostname;
      // 只对含点的真实域名做配对（跳过 localhost 等单标签主机）。
      if (!host.includes('.')) continue;
      const paired = host.startsWith('www.')
        ? host.slice(4)               // www.example.com → example.com
        : `www.${host}`;              // example.com → www.example.com
      const portPart = u.port ? `:${u.port}` : '';
      out.add(`${u.protocol}//${paired}${portPart}`);
    } catch {
      // 非 URL 形式（不该发生,env 里都是完整 origin）——原样保留即可。
    }
  }
  return [...out];
}

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
    return envValue.split(',').map((o) => o.trim()).filter(Boolean);
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return [appUrl.replace(/\/$/, '')];
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

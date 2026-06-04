/**
 * Schema for `config/routes.yaml` — the route ownership manifest
 * introduced in ADR 0014. Used by:
 *   - `build-routes.ts` to validate the YAML before emitting JSON
 *   - `check-route-coverage.ts` to compare app routes against the manifest
 *   - (Phase 3) `check-links.ts` to validate cross-site links
 *
 * Keep this file PURE (no Node-only imports) so it can run in
 * scripts/, tests, and the Workers runtime if we ever publish the
 * routes.json behind a route handler.
 */

export type RouteStatus = 'canonical-here' | 'mirror' | 'redirect-to';

export type LocaleScope =
  | 'all'
  | 'en-only'
  | 'none'
  | readonly string[]; // explicit list like ['en','zh']

export type AuthLevel = 'public' | 'required' | 'admin' | 'internal';

export type RouteEntry = {
  /** Path with locale segment stripped. Dynamic segments use `:id`. */
  path: string;
  status: RouteStatus;
  owner: string;
  /** Required when status is `mirror` or `redirect-to`. */
  canonicalUrl?: string;
  /** Required when status is `redirect-to`. */
  redirectCode?: 301 | 302 | 307 | 308;
  auth?: AuthLevel;
  publicApi?: boolean;
  locales: LocaleScope;
  source?: string;
  notes?: string;
};

export type RoutesManifest = {
  version: 1;
  site: 'cloud' | 'lang-dev';
  baseUrl: string;
  locales: {
    default: string;
    prefixed: readonly string[];
  };
  /** ISO timestamp; null in the YAML, generator may stamp the JSON. */
  generatedAt: string | null;
  routes: readonly RouteEntry[];
  allowLinks?: readonly {
    path: string;
    reason: string;
    expires: string; // ISO date
    owner: string;
  }[];
};

/**
 * Validation result from `validateManifest`. Generator + verifier both
 * exit non-zero when `errors.length > 0`. Warnings surface to stderr
 * but don't fail.
 */
export type ValidationResult = {
  errors: string[];
  warnings: string[];
};

/**
 * Validate a parsed manifest against the schema invariants. This is
 * intentionally hand-rolled rather than a Zod schema because the
 * generator runs in the build pipeline (`pnpm run routes:build`) and
 * adding a runtime schema dep just for one config file would bloat
 * the worker bundle if anyone ever imports it from app code.
 */
export function validateManifest(m: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!m || typeof m !== 'object') {
    errors.push('manifest is not an object');
    return { errors, warnings };
  }
  const obj = m as Record<string, unknown>;
  if (obj.version !== 1) {
    errors.push(`unsupported manifest version: ${String(obj.version)} (expected 1)`);
  }
  if (obj.site !== 'cloud' && obj.site !== 'lang-dev') {
    errors.push(`invalid site: ${String(obj.site)} (expected "cloud" or "lang-dev")`);
  }
  if (typeof obj.baseUrl !== 'string' || !obj.baseUrl.startsWith('https://')) {
    errors.push(`baseUrl must be an https:// URL string, got ${typeof obj.baseUrl}`);
  }
  if (!Array.isArray(obj.routes)) {
    errors.push('routes must be an array');
    return { errors, warnings };
  }

  const seenPaths = new Set<string>();
  for (let i = 0; i < obj.routes.length; i++) {
    const r = obj.routes[i] as Record<string, unknown>;
    const ctx = `routes[${i}] (path=${r?.path ?? '?'})`;
    if (typeof r.path !== 'string' || !r.path.startsWith('/')) {
      errors.push(`${ctx}: path must be a string starting with "/"`);
      continue;
    }
    if (seenPaths.has(r.path)) {
      errors.push(`${ctx}: duplicate path entry`);
    }
    seenPaths.add(r.path);
    if (r.status !== 'canonical-here' && r.status !== 'mirror' && r.status !== 'redirect-to') {
      errors.push(`${ctx}: invalid status ${String(r.status)}`);
    }
    if (typeof r.owner !== 'string' || !r.owner) {
      errors.push(`${ctx}: owner must be a non-empty string`);
    }
    if (r.status === 'redirect-to' || r.status === 'mirror') {
      if (typeof r.canonicalUrl !== 'string' || !r.canonicalUrl.startsWith('http')) {
        errors.push(`${ctx}: status=${r.status} requires canonicalUrl (https://… )`);
      }
    }
    if (r.status === 'redirect-to' && r.redirectCode !== undefined) {
      const code = Number(r.redirectCode);
      if (![301, 302, 307, 308].includes(code)) {
        errors.push(`${ctx}: redirectCode must be 301/302/307/308`);
      }
    }
    if (r.status === 'redirect-to' && r.redirectCode === undefined) {
      warnings.push(`${ctx}: redirect-to entry missing redirectCode (defaults vary by CDN)`);
    }
    if (r.locales === undefined) {
      errors.push(`${ctx}: missing required field "locales"`);
    }
  }

  return { errors, warnings };
}

/**
 * Convert a manifest route path to a regex that matches concrete URLs.
 * Used by the coverage verifier and the (Phase 3) link checker.
 *
 *   `/docs/api/policies/*`  → matches `/docs/api/policies/evaluate`, `/docs/api/policies/foo/bar`
 *   `/policies/:id`         → matches `/policies/abc123` (single segment)
 *   `/api/v1/*`             → matches `/api/v1/policies/evaluate`
 *
 * Leading `/` is required. Trailing `/` is normalized away in the matcher.
 */
export function routePatternToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/\/$/, '') || '/';
  const escaped = normalized
    .split('/')
    .map((segment) => {
      if (segment === '') return '';
      if (segment === '*') return '.*'; // wildcard matches one or more segments
      if (segment.startsWith(':')) return '[^/]+'; // dynamic single-segment
      return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${escaped}/?$`);
}

/**
 * Strip leading locale prefix (`/zh/foo` → `/foo`, `/de/foo` → `/foo`,
 * `/foo` → `/foo`). The default locale (en) is bare per
 * `localePrefix: 'as-needed'`, so a path that does NOT start with a
 * known prefix is treated as default-locale.
 */
export function stripLocalePrefix(path: string, prefixed: readonly string[]): { locale: string; path: string } {
  for (const loc of prefixed) {
    if (path === `/${loc}` || path.startsWith(`/${loc}/`)) {
      return { locale: loc, path: path.slice(`/${loc}`.length) || '/' };
    }
  }
  return { locale: 'default', path };
}

/**
 * POST /api/docs/jump — audit log writer for docs→app cross-domain jumps.
 *
 * When an authenticated user clicks a docs page action that crosses
 * into the application surface (Playground, Policy Editor, Security,
 * etc.), the `<DocsPageActions>` component fires a fire-and-forget
 * POST to this endpoint with the minimum metadata needed to trace the
 * action for SOC2 / compliance:
 *   - `slug`   — the docs route the user was on
 *   - `cta_id` — the stable action id from the registry
 *   - `target` — the canonical app path (no query string echoed back)
 *   - `locale` — the docs locale
 *
 * Why a dedicated endpoint vs. logging on the target route:
 *   - We capture the *intent* (clicked from docs) even if the target
 *     route never loads (user closes the tab mid-redirect).
 *   - The target routes don't know they were entered "from docs" —
 *     reading a query string is brittle and easily stripped.
 *   - Compliance asks for the docs → app funnel; centralising the
 *     write here gives a single shape to query.
 *
 * Failure mode:
 *   - Anonymous → 204 (no audit row, no error). The jump endpoint is
 *     fire-and-forget so the docs CTA navigation still completes.
 *   - Schema mismatch → 400. The component validates client-side too,
 *     but defense in depth.
 *   - DB write failure → swallowed at the `logAuditEvent` boundary
 *     (already best-effort there).
 *
 * Caching: identical to session-state.
 * Rate limit: `RateLimitPresets.API` per IP.
 */

import { auth } from '@/auth';
import { logAuditEvent, extractClientInfo } from '@/lib/audit-log';
import {
  checkRateLimit,
  RateLimitPresets,
  getClientIp,
  getRateLimitHeaders,
} from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/security/csrf';
import { resolveAuditedAction } from '@/lib/docs/page-actions';
import { locales } from '@/i18n/config';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
} as const;

/**
 * Validates the request body shape. Returns the typed payload or null
 * if any field is missing/malformed. Keeping this synchronous and
 * dependency-free avoids pulling Zod into the hot path.
 */
function parseJumpPayload(value: unknown): {
  slug: string;
  cta_id: string;
  target: string;
  locale: string;
} | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const slug = obj.slug;
  const ctaId = obj.cta_id;
  const target = obj.target;
  const locale = obj.locale;
  if (
    typeof slug !== 'string' ||
    typeof ctaId !== 'string' ||
    typeof target !== 'string' ||
    typeof locale !== 'string'
  ) {
    return null;
  }
  // Reject suspicious lengths and shapes early. The docs registry
  // generates IDs and slugs of bounded size; anything bigger is most
  // likely a probe attempt.
  if (slug.length > 200 || ctaId.length > 80 || target.length > 200 || locale.length > 8) {
    return null;
  }
  // Target must be a relative path beginning with '/' — never a
  // foreign URL. This prevents the audit row from being used as a
  // mirror for arbitrary attacker-supplied strings.
  if (!target.startsWith('/') || target.startsWith('//')) {
    return null;
  }
  // Locale must be one of the configured next-intl locales — keeps
  // audit metadata aligned with the locale dimension we filter on.
  if (!(locales as readonly string[]).includes(locale)) {
    return null;
  }
  return { slug, cta_id: ctaId, target, locale };
}

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const rate = checkRateLimit(`docs-jump:${ip}`, RateLimitPresets.API);
  const rateHeaders = getRateLimitHeaders(rate, RateLimitPresets.API);
  if (!rate.allowed) {
    return new Response(null, {
      status: 429,
      headers: { ...PRIVATE_HEADERS, ...rateHeaders },
    });
  }

  // CSRF gate: this endpoint mutates audit state via cookie auth, so
  // it must follow the repo's Origin/Referer pattern. Bearer tokens
  // (Authorization header) and safe methods pass through automatically.
  const csrf = checkCsrf(request);
  if (!csrf.allowed) {
    return new Response(null, {
      status: 403,
      headers: { ...PRIVATE_HEADERS, ...rateHeaders },
    });
  }

  let payload: ReturnType<typeof parseJumpPayload>;
  try {
    payload = parseJumpPayload(await request.json());
  } catch {
    payload = null;
  }
  if (!payload) {
    return new Response(null, {
      status: 400,
      headers: { ...PRIVATE_HEADERS, ...rateHeaders },
    });
  }

  // Bind the payload to the registry: slug must exist, cta_id must
  // match an action declared `audit: true` for that slug, and target
  // must equal that action's canonical pathname. Anything else means
  // the caller is fabricating an audit row.
  const matched = resolveAuditedAction(payload);
  if (!matched) {
    return new Response(null, {
      status: 400,
      headers: { ...PRIVATE_HEADERS, ...rateHeaders },
    });
  }

  try {
    const session = await auth();
    if (!session?.user?.id) {
      // Anonymous click — we don't log (no actor); reply 204 so the
      // browser's sendBeacon dispatch returns cleanly and the docs
      // navigation completes.
      return new Response(null, {
        status: 204,
        headers: { ...PRIVATE_HEADERS, ...rateHeaders },
      });
    }

    const { ipAddress, userAgent } = extractClientInfo(request);
    await logAuditEvent({
      userId: session.user.id,
      // teamId omitted — docs jumps are user-scoped; per-team audit
      // happens once the user lands on a team-scoped resource.
      action: 'docs.jump',
      resource: 'docs',
      resourceId: payload.slug,
      metadata: {
        cta_id: payload.cta_id,
        target: payload.target,
        locale: payload.locale,
      },
      ipAddress,
      userAgent,
    });

    return new Response(null, {
      status: 204,
      headers: { ...PRIVATE_HEADERS, ...rateHeaders },
    });
  } catch (err) {
    console.error('[docs-jump] failed to log', err);
    // Best-effort: don't surface to client (the user is already
    // navigating away). 204 keeps the beacon path clean.
    return new Response(null, {
      status: 204,
      headers: { ...PRIVATE_HEADERS, ...rateHeaders },
    });
  }
}

/**
 * GET /api/docs/session-state — docs-only session probe.
 *
 * Returns the **minimum** signal the docs UI needs to render auth-aware
 * affordances (top-nav avatar, "Try in your tenant" CTAs, trust footer
 * tenant row) without leaking PII into docs HTML or the CDN cache.
 *
 * Contract — **never extend without security review**:
 *   - Response body: `{ authenticated, capabilities, subjectHash, schemaVersion }`
 *   - NEVER include: email, name, userId, tenantId, teamId, plan name,
 *     audit log row count, anything tenant-identifying.
 *   - `subjectHash` is a non-PII opaque per-user 8-byte hex used only as
 *     a deterministic seed for the avatar gradient (so the avatar is
 *     stable per user across sessions without exposing the userId).
 *
 * Caching:
 *   - `Cache-Control: private, no-store, max-age=0` + `Vary: Cookie`
 *   - The probe MUST NOT be cached by any CDN, browser, or service worker
 *     since the response depends on the auth cookie.
 *
 * Failure mode (fail-closed):
 *   - On any internal error, return 503 with `{ authenticated: false, ... }`
 *     so the docs UI renders the anonymous chrome rather than spinning.
 *
 * Rate limit:
 *   - 60 req/min per client IP (matches `RateLimitPresets.API`).
 *   - Probe is debounced client-side to ~1 req/page/5 min in practice;
 *     the limit guards against malicious flood, not legitimate traffic.
 */

import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db, teamMembers } from '@/lib/prisma';
import { getEffectiveRole, canAccess } from '@/lib/effective-role';
import {
  checkRateLimit,
  RateLimitPresets,
  getClientIp,
  getRateLimitHeaders,
} from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const SCHEMA_VERSION = 1;

type Capabilities = {
  canUsePlayground: boolean;
  canEditPolicies: boolean;
  canViewAudit: boolean;
  hasActiveTeam: boolean;
};

type SessionState = {
  authenticated: boolean;
  capabilities: Capabilities;
  /** 16-hex-char deterministic per-user seed for the avatar gradient. Empty for anonymous. */
  subjectHash: string;
  schemaVersion: number;
};

const ANONYMOUS_STATE: SessionState = {
  authenticated: false,
  capabilities: {
    canUsePlayground: true, // public preview tenant
    canEditPolicies: false,
    canViewAudit: false,
    hasActiveTeam: false,
  },
  subjectHash: '',
  schemaVersion: SCHEMA_VERSION,
};

const PROBE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

/**
 * Convert a userId into a stable 16-hex-char hash via Web Crypto SHA-256
 * (truncated to 8 bytes). Web Crypto is available on Cloudflare Workers
 * and avoids pulling in `node:crypto`. The truncation is fine here: the
 * hash is only an avatar-gradient seed, not a security primitive.
 */
async function subjectHashFromUserId(userId: string): Promise<string> {
  const data = new TextEncoder().encode(`docs:v1:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest).slice(0, 8);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function GET(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const rate = checkRateLimit(`docs-session:${ip}`, RateLimitPresets.API);
  const rateHeaders = getRateLimitHeaders(rate, RateLimitPresets.API);

  if (!rate.allowed) {
    return new Response(JSON.stringify(ANONYMOUS_STATE), {
      status: 429,
      headers: { ...PROBE_HEADERS, ...rateHeaders },
    });
  }

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return new Response(JSON.stringify(ANONYMOUS_STATE), {
        status: 200,
        headers: { ...PROBE_HEADERS, ...rateHeaders },
      });
    }

    // Run role + team-membership lookups in parallel. `hasActiveTeam`
    // must reflect *real* team membership, not `getEffectiveRole()`'s
    // solo-user-as-owner shorthand — otherwise every authenticated
    // user appears to belong to a team and team-scoped CTAs render
    // for solo users with no team context to act on.
    const [role, memberships, subjectHash] = await Promise.all([
      getEffectiveRole(session.user.id),
      db.query.teamMembers.findFirst({
        where: eq(teamMembers.userId, session.user.id),
        columns: { teamId: true },
      }),
      subjectHashFromUserId(session.user.id),
    ]);

    const state: SessionState = {
      authenticated: true,
      capabilities: {
        canUsePlayground: true,
        canEditPolicies: canAccess(role, 'member'),
        canViewAudit: canAccess(role, 'admin'),
        hasActiveTeam: memberships !== null && memberships !== undefined,
      },
      subjectHash,
      schemaVersion: SCHEMA_VERSION,
    };

    return new Response(JSON.stringify(state), {
      status: 200,
      headers: { ...PROBE_HEADERS, ...rateHeaders },
    });
  } catch (err) {
    // Fail-closed: docs UI renders anonymous chrome on error.
    console.error('[docs-session-state] probe failed', err);
    return new Response(JSON.stringify(ANONYMOUS_STATE), {
      status: 503,
      headers: { ...PROBE_HEADERS, ...rateHeaders },
    });
  }
}

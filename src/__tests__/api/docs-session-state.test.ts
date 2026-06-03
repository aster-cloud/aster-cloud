// /api/docs/session-state — docs-only session probe
//
// Hard requirements (see .claude/plan/docs-enterprise-ux.md §1.1):
//   1. Anonymous request → 200 + ANONYMOUS_STATE; no PII fields.
//   2. Authenticated request → 200 + capabilities derived from role,
//      subjectHash is a 16-hex-char opaque token, no PII fields.
//   3. Cache-Control: private, no-store, max-age=0 + Vary: Cookie
//      on every response (including 429/503).
//   4. Auth.js throws → 503 + ANONYMOUS_STATE (fail-closed).
//   5. Rate limited → 429 + ANONYMOUS_STATE.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getEffectiveRole: vi.fn(),
  checkRateLimit: vi.fn(),
  teamMembersFindFirst: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      teamMembers: { findFirst: mocks.teamMembersFindFirst },
    },
  },
  teamMembers: { userId: 'userId' },
}));
vi.mock('@/lib/effective-role', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/effective-role')>('@/lib/effective-role');
  return {
    ...actual,
    getEffectiveRole: mocks.getEffectiveRole,
  };
});
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return {
    ...actual,
    checkRateLimit: mocks.checkRateLimit,
  };
});

import { GET } from '@/app/api/docs/session-state/route';

const ALLOWED = {
  allowed: true as const,
  remaining: 59,
  resetAt: Date.now() + 60_000,
};

function makeRequest() {
  return new Request('https://example.com/api/docs/session-state', {
    method: 'GET',
    headers: { 'cf-connecting-ip': '203.0.113.7' },
  });
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.getEffectiveRole.mockReset();
  mocks.checkRateLimit.mockReset();
  mocks.teamMembersFindFirst.mockReset();
  mocks.checkRateLimit.mockReturnValue(ALLOWED);
  // Default: user belongs to at least one team. Tests that exercise
  // the solo-user case override this explicitly.
  mocks.teamMembersFindFirst.mockResolvedValue({ teamId: 't-1' });
});

describe('GET /api/docs/session-state', () => {
  it('returns ANONYMOUS_STATE when no session', async () => {
    mocks.auth.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(res.headers.get('Vary')).toBe('Cookie');
    const body = await res.json();
    expect(body).toMatchObject({
      authenticated: false,
      capabilities: {
        canUsePlayground: true,
        canEditPolicies: false,
        canViewAudit: false,
        hasActiveTeam: false,
      },
      subjectHash: '',
      schemaVersion: 1,
    });
  });

  it('returns capability-derived state for an admin user', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-admin-1' } });
    mocks.getEffectiveRole.mockResolvedValueOnce('admin');

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.capabilities.canEditPolicies).toBe(true);
    expect(body.capabilities.canViewAudit).toBe(true);
    expect(body.subjectHash).toMatch(/^[0-9a-f]{16}$/);
    // PII guard — make absolutely sure the response shape stays minimal.
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('tenantId');
    expect(body).not.toHaveProperty('teamId');
  });

  it('viewer cannot edit policies or view audit', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-viewer-1' } });
    mocks.getEffectiveRole.mockResolvedValueOnce('viewer');

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.capabilities.canEditPolicies).toBe(false);
    expect(body.capabilities.canViewAudit).toBe(false);
    // Playground access is public; viewer keeps it.
    expect(body.capabilities.canUsePlayground).toBe(true);
  });

  it('solo user (no team memberships) has hasActiveTeam=false', async () => {
    // Regression guard: `getEffectiveRole()` returns 'owner' for users
    // with zero team memberships (so solo users see their personal
    // dashboard fully), but the docs probe must still report
    // `hasActiveTeam: false` so team-scoped CTAs do not render.
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-solo-1' } });
    mocks.getEffectiveRole.mockResolvedValueOnce('owner');
    mocks.teamMembersFindFirst.mockResolvedValueOnce(undefined);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.capabilities.hasActiveTeam).toBe(false);
    expect(body.capabilities.canEditPolicies).toBe(true); // owner-equivalent
  });

  it('subjectHash is deterministic per userId', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'u-deterministic' } });
    mocks.getEffectiveRole.mockResolvedValue('member');

    const first = await (await GET(makeRequest())).json();
    const second = await (await GET(makeRequest())).json();
    expect(first.subjectHash).toEqual(second.subjectHash);
  });

  it('fail-closed: returns 503 + ANONYMOUS when auth throws', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('boom'));

    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.subjectHash).toBe('');
  });

  it('rate-limited request returns 429 + ANONYMOUS', async () => {
    mocks.checkRateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 30,
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  });
});

// /api/docs/jump — audit-log writer for docs→app cross-domain jumps
//
// Invariants:
//   - anonymous request → 204 (no audit row written)
//   - authenticated request with valid payload → 204 + logAuditEvent called
//   - malformed payload → 400, no audit row
//   - non-relative target (absolute URL) → 400, no audit row
//   - rate-limited → 429
//   - DB write failure inside logAuditEvent is swallowed; route still returns 204

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
  return {
    ...actual,
    checkRateLimit: mocks.checkRateLimit,
  };
});
vi.mock('@/lib/audit-log', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit-log')>('@/lib/audit-log');
  return {
    ...actual,
    logAuditEvent: mocks.logAuditEvent,
  };
});

import { POST } from '@/app/api/docs/jump/route';

const ALLOWED = { allowed: true as const, remaining: 59, resetAt: Date.now() + 60_000 };

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.com/api/docs/jump', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '203.0.113.7',
      'content-type': 'application/json',
      // Default to a same-origin Origin header so the CSRF gate
      // passes; individual tests override when they want to trigger
      // the 403 path.
      origin: 'https://example.com',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

// CSRF allow-list pulled from src/lib/security/csrf.ts in the test env.
// We set CSRF_ALLOWED_ORIGINS so the default lookup permits our test origin.
process.env.CSRF_ALLOWED_ORIGINS = 'https://example.com';

const ASSERT_PRIVATE_HEADERS = (res: Response): void => {
  expect(res.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(res.headers.get('Vary')).toBe('Cookie');
};

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.checkRateLimit.mockReset();
  mocks.logAuditEvent.mockReset();
  mocks.checkRateLimit.mockReturnValue(ALLOWED);
});

describe('POST /api/docs/jump', () => {
  const validPayload = {
    slug: 'api/policies/evaluate',
    cta_id: 'playground_evaluate',
    target: '/playground',
    locale: 'en',
  };

  it('returns 204 for anonymous click without writing audit', async () => {
    mocks.auth.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(204);
    ASSERT_PRIVATE_HEADERS(res);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('returns 204 + writes audit row for authenticated user', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(204);
    expect(mocks.logAuditEvent).toHaveBeenCalledTimes(1);
    const call = mocks.logAuditEvent.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: 'u-1',
      action: 'docs.jump',
      resource: 'docs',
      resourceId: 'api/policies/evaluate',
      metadata: {
        cta_id: 'playground_evaluate',
        target: '/playground',
        locale: 'en',
      },
    });
  });

  it('returns 400 on malformed payload (missing fields)', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(makeRequest({ slug: 'a' }));
    expect(res.status).toBe(400);
    ASSERT_PRIVATE_HEADERS(res);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when slug is unknown (registry binding)', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(
      makeRequest({ ...validPayload, slug: 'fictional/route' }),
    );
    expect(res.status).toBe(400);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when cta_id does not belong to the slug', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(
      makeRequest({ ...validPayload, cta_id: 'playground_audit_logs' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when target does not match the canonical action target', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(
      makeRequest({ ...validPayload, target: '/dashboard' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when locale is not a supported next-intl locale', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(makeRequest({ ...validPayload, locale: 'fr' }));
    expect(res.status).toBe(400);
  });

  it('returns 403 when Origin / Referer fail the CSRF gate', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(
      makeRequest(validPayload, { origin: 'https://evil.example.com' }),
    );
    expect(res.status).toBe(403);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects absolute URL targets (security guard)', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(
      makeRequest({ ...validPayload, target: 'https://evil.example.com/' }),
    );
    expect(res.status).toBe(400);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects protocol-relative URL targets (//foo)', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    const res = await POST(
      makeRequest({ ...validPayload, target: '//evil.example.com/playground' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate-limited', async () => {
    mocks.checkRateLimit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfterSeconds: 30,
    });
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(429);
    ASSERT_PRIVATE_HEADERS(res);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('swallows DB write errors and still returns 204', async () => {
    mocks.auth.mockResolvedValueOnce({ user: { id: 'u-1' } });
    mocks.logAuditEvent.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(204);
    ASSERT_PRIVATE_HEADERS(res);
  });
});

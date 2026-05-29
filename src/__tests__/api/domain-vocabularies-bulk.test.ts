/**
 * Route-handler tests for POST /api/v1/domain-vocabularies/bulk (B10).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/api/idempotency', async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    withIdempotency: vi.fn(async (_req: Request, _opts, handler: () => Promise<unknown>) => {
      const result = (await handler()) as { status: number; body: unknown };
      return { ...result, replayed: false };
    }),
  };
});

vi.mock('@/lib/rate-limit', async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    checkRateLimit: vi.fn(),
    getRateLimitHeaders: vi.fn().mockReturnValue({}),
  };
});

vi.mock('@/lib/domain-vocabulary', async (orig) => {
  const original = (await orig()) as Record<string, unknown>;
  return {
    ...original,
    bulkAddUserVocabularyTerms: vi.fn(),
  };
});

import { POST as bulkPost } from '@/app/api/v1/domain-vocabularies/bulk/route';
import { getSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  VocabularyError,
  bulkAddUserVocabularyTerms,
} from '@/lib/domain-vocabulary';

function mockSession(userId: string | null) {
  if (userId === null) {
    vi.mocked(getSession).mockResolvedValue(null as unknown as Awaited<ReturnType<typeof getSession>>);
  } else {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: userId },
    } as unknown as Awaited<ReturnType<typeof getSession>>);
  }
}

function bulkReq(body: unknown) {
  return new Request('http://localhost/api/v1/domain-vocabularies/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validTerm = {
  domain: 'finance.loan',
  locale: 'en-US',
  kind: 'struct',
  canonical: 'Loan',
  localized: 'Loan',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSession('user-1');
  vi.mocked(checkRateLimit).mockReturnValue({
    allowed: true,
    remaining: 4,
    resetAt: Date.now() + 3_600_000,
  });
});

describe('POST /api/v1/domain-vocabularies/bulk', () => {
  it('returns 401 when unauthenticated', async () => {
    mockSession(null);

    const res = await bulkPost(bulkReq({ terms: [validTerm] }));

    expect(res.status).toBe(401);
  });

  it('returns 429 when the per-user rate limit triggers', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      retryAfterSeconds: 60,
    });

    const res = await bulkPost(bulkReq({ terms: [validTerm] }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error.code).toBe('rate_limited');
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await bulkPost(bulkReq('not json'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 when the terms array is missing', async () => {
    const res = await bulkPost(bulkReq({}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 400 when a term row has the wrong kind', async () => {
    const res = await bulkPost(
      bulkReq({ terms: [{ ...validTerm, kind: 'paragraph' }] }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('validation_failed');
  });

  it('returns 200 with the service rollup on success', async () => {
    vi.mocked(bulkAddUserVocabularyTerms).mockResolvedValue({
      jobId: 'job-1',
      status: 'completed',
      mode: 'sync',
      rowCount: 1,
      processed: 1,
      rollup: { added: 1, reused: 0, modified: 0, skipped: 0, errorCount: 0 },
      errors: [],
    });

    const res = await bulkPost(bulkReq({ terms: [validTerm] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.jobId).toBe('job-1');
    expect(body.rollup.added).toBe(1);
  });

  it('returns 403 when the service throws plan_gate_required', async () => {
    vi.mocked(bulkAddUserVocabularyTerms).mockRejectedValue(
      new VocabularyError('plan_gate_required', 'Upgrade required'),
    );

    const res = await bulkPost(bulkReq({ terms: [validTerm] }));

    expect(res.status).toBe(403);
  });
});

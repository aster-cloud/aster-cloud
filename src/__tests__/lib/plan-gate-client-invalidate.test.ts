import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
const originalUrl = process.env.ASTER_API_INTERNAL_URL;

describe('invalidateApiKeyCache', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ASTER_PLAN_GATE_HMAC_KEY = 'test-secret-32chars-min-len-please';
    process.env.ASTER_API_INTERNAL_URL = 'http://aster-api.test';
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as never;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
    if (originalUrl === undefined) delete process.env.ASTER_API_INTERNAL_URL;
    else process.env.ASTER_API_INTERNAL_URL = originalUrl;
    vi.restoreAllMocks();
  });

  it('calls aster-api DELETE /api/internal/apikey-cache/{userId} with HMAC headers', async () => {
    const { invalidateApiKeyCache } = await import('@/lib/plan-gate-client');
    await invalidateApiKeyCache('user-123');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://aster-api.test/api/internal/apikey-cache/user-123');
    expect((init as RequestInit).method).toBe('DELETE');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Aster-Timestamp']).toMatch(/^\d+$/);
    expect(headers['X-Aster-Signature']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('empty userId is no-op', async () => {
    const { invalidateApiKeyCache } = await import('@/lib/plan-gate-client');
    await invalidateApiKeyCache('');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetch failure does not throw（fail-open）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as never;
    const { invalidateApiKeyCache } = await import('@/lib/plan-gate-client');
    await expect(invalidateApiKeyCache('user-1')).resolves.toBeUndefined();
  });

  it('non-2xx response does not throw（fail-open）', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as never;
    const { invalidateApiKeyCache } = await import('@/lib/plan-gate-client');
    await expect(invalidateApiKeyCache('user-1')).resolves.toBeUndefined();
  });
});

describe('invalidatePlanCache (regression)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ASTER_PLAN_GATE_HMAC_KEY = 'test-secret-32chars-min-len-please';
    process.env.ASTER_API_INTERNAL_URL = 'http://aster-api.test';
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as never;
  });

  it('calls plan-cache (not apikey-cache) for plan invalidation', async () => {
    const { invalidatePlanCache } = await import('@/lib/plan-gate-client');
    await invalidatePlanCache('user-456');
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/internal/plan-cache/user-456');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
const originalUrl = process.env.ASTER_API_INTERNAL_URL;

const { mockFindFirst } = vi.hoisted(() => ({ mockFindFirst: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      users: { findFirst: mockFindFirst },
      apiKeys: { findFirst: mockFindFirst },
    },
  },
  users: { id: {} },
  apiKeys: { id: {}, key: {} },
}));

describe('pushUserSnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindFirst.mockReset();
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

  it('POST 到 /api/internal/snapshot/user/{userId} with HMAC + traceparent', async () => {
    mockFindFirst.mockResolvedValue({
      plan: 'pro',
      priceLockedAt: null,
      legacyTier: null,
      subscriptionStatus: 'active',
      aiBannedUntil: null,
      gracePeriodEndsAt: null,
    });
    const { pushUserSnapshot } = await import('@/lib/snapshot-pusher');
    await pushUserSnapshot('user-123');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://aster-api.test/api/internal/snapshot/user/user-123');
    expect((init as RequestInit).method).toBe('POST');

    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Aster-Timestamp']).toMatch(/^\d+$/);
    expect(headers['X-Aster-Signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.plan).toBe('pro');
    expect(body.subscriptionStatus).toBe('active');
    expect(body.aiBannedUntilEpochMs).toBeNull();
  });

  it('user 不存在 → 不 fetch（让 aster-api 缓存自然过期）', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const { pushUserSnapshot } = await import('@/lib/snapshot-pusher');
    await pushUserSnapshot('ghost');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('空 userId → no-op', async () => {
    const { pushUserSnapshot } = await import('@/lib/snapshot-pusher');
    await pushUserSnapshot('');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('aiBannedUntil 转 epoch ms', async () => {
    const banDate = new Date('2026-06-01T00:00:00Z');
    mockFindFirst.mockResolvedValue({
      plan: 'free',
      priceLockedAt: null,
      legacyTier: null,
      subscriptionStatus: null,
      aiBannedUntil: banDate,
      gracePeriodEndsAt: null,
    });
    const { pushUserSnapshot } = await import('@/lib/snapshot-pusher');
    await pushUserSnapshot('user-1');
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.aiBannedUntilEpochMs).toBe(banDate.getTime());
  });

  it('fetch 失败 fail-open（不抛）', async () => {
    mockFindFirst.mockResolvedValue({
      plan: 'pro',
      priceLockedAt: null,
      legacyTier: null,
      subscriptionStatus: 'active',
      aiBannedUntil: null,
      gracePeriodEndsAt: null,
    });
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as never;
    const { pushUserSnapshot } = await import('@/lib/snapshot-pusher');
    await expect(pushUserSnapshot('user-1')).resolves.toBeUndefined();
  });
});

describe('pushApiKeySnapshot', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindFirst.mockReset();
    process.env.ASTER_PLAN_GATE_HMAC_KEY = 'test-secret-32chars-min-len-please';
    process.env.ASTER_API_INTERNAL_URL = 'http://aster-api.test';
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as never;
  });

  it('keyHash 长度不是 64 → no-op', async () => {
    const { pushApiKeySnapshot } = await import('@/lib/snapshot-pusher');
    await pushApiKeySnapshot('short');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keyHash 长度 64 但非 hex → no-op（不查 DB、不 fetch）', async () => {
    const { pushApiKeySnapshot } = await import('@/lib/snapshot-pusher');
    await pushApiKeySnapshot('g'.repeat(64));
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('未找到 key → 推送 valid:false reason:not_found', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const hash = 'a'.repeat(64);
    const { pushApiKeySnapshot } = await import('@/lib/snapshot-pusher');
    await pushApiKeySnapshot(hash);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('not_found');
  });

  it('已撤销 key → valid:false reason:revoked', async () => {
    const revokedAt = new Date('2026-04-01');
    mockFindFirst.mockResolvedValue({
      id: 'k1',
      userId: 'u1',
      revokedAt,
      expiresAt: null,
    });
    const hash = 'b'.repeat(64);
    const { pushApiKeySnapshot } = await import('@/lib/snapshot-pusher');
    await pushApiKeySnapshot(hash);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('revoked');
    expect(body.revokedAtEpochMs).toBe(revokedAt.getTime());
  });

  it('过期 key → reason:expired', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'k1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date('2020-01-01'), // 已过期
    });
    const hash = 'c'.repeat(64);
    const { pushApiKeySnapshot } = await import('@/lib/snapshot-pusher');
    await pushApiKeySnapshot(hash);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('expired');
  });

  it('有效 key → 下发 tenantId（租户隔离回归）', async () => {
    // 第一次 findFirst = apiKeys 查询；第二次 = users plan 查询
    mockFindFirst
      .mockResolvedValueOnce({
        id: 'k1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: null, // 永不过期
      })
      .mockResolvedValueOnce({ plan: 'pro' });
    const hash = 'd'.repeat(64);
    const { pushApiKeySnapshot } = await import('@/lib/snapshot-pusher');
    await pushApiKeySnapshot(hash);
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.valid).toBe(true);
    expect(body.apiKeyId).toBe('k1');
    expect(body.userId).toBe('u1');
    // 核心断言：snapshot 必须带权威 tenantId（当前与 userId 同源）。
    // 缺失会让 aster-api snapshot 命中路径丢失租户、退化为跨租户隔离风险。
    expect(body.tenantId).toBe('u1');
    // 权威 RBAC 角色：aster-api 用它无条件覆盖 X-User-Role（防提权）。
    // tenantId===userId → owner。
    expect(body.role).toBe('owner');
    expect(body.plan).toBe('pro');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * /api/internal/apikey/verify 路由级回归：keyHash 必须是 64 位 hex。
 * 非 hex（即便长度 64）应在查 DB 前以 400 拒绝，收紧输入卫生、避免脏值进 SQL。
 *
 * HMAC 在 ASTER_PLAN_GATE_HMAC_KEY 未设置时跳过，便于隔离校验逻辑。
 */

const { mockFindFirst } = vi.hoisted(() => ({ mockFindFirst: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      apiKeys: { findFirst: mockFindFirst },
      users: { findFirst: mockFindFirst },
    },
  },
  apiKeys: { key: 'apiKeys.key' },
  users: { id: 'users.id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
}));

const originalKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;

function postKeyHash(body: unknown): Request {
  return new Request('http://cloud.test/api/internal/apikey/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/internal/apikey/verify — keyHash hex 校验', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindFirst.mockReset();
    delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('长度 64 但非 hex → 400，不查 DB', async () => {
    const { POST } = await import('@/app/api/internal/apikey/verify/route');
    const res = await POST(postKeyHash({ keyHash: 'z'.repeat(64) }));
    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('长度不是 64 → 400，不查 DB', async () => {
    const { POST } = await import('@/app/api/internal/apikey/verify/route');
    const res = await POST(postKeyHash({ keyHash: 'abc' }));
    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('keyHash 缺失 → 400', async () => {
    const { POST } = await import('@/app/api/internal/apikey/verify/route');
    const res = await POST(postKeyHash({}));
    expect(res.status).toBe(400);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('合法 64 hex → 查 DB（命中 not_found 分支）', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    const { POST } = await import('@/app/api/internal/apikey/verify/route');
    const res = await POST(postKeyHash({ keyHash: 'a'.repeat(64) }));
    expect(res.status).toBe(200);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('not_found');
  });
});

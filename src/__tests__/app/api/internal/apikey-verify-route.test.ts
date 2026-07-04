import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

/**
 * /api/internal/apikey/verify 路由级回归：
 *  - keyHash 必须是 64 位 hex（非 hex/错长度 → 400，且不查 DB）
 *  - fail-closed：HMAC 密钥未配置 → 503（audit #168）；坏签名 → 401
 *
 * 输入校验用例携带合法签名以隔离校验逻辑。
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
const TEST_KEY = 'test-shared-hmac-key';
const PATH = '/api/internal/apikey/verify';

function signedHeaders(key: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', key).update(`POST\n${PATH}\n${ts}`).digest('hex');
  return {
    'Content-Type': 'application/json',
    'X-Aster-Timestamp': ts,
    'X-Aster-Signature': sig,
  };
}

function postKeyHash(body: unknown, headers?: Record<string, string>): Request {
  return new Request(`http://cloud.test${PATH}`, {
    method: 'POST',
    headers: headers ?? signedHeaders(TEST_KEY),
    body: JSON.stringify(body),
  });
}

describe('POST /api/internal/apikey/verify — keyHash hex 校验', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindFirst.mockReset();
    process.env.ASTER_PLAN_GATE_HMAC_KEY = TEST_KEY;
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

describe('POST /api/internal/apikey/verify — fail-closed HMAC (audit #168)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindFirst.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('HMAC 密钥未配置 → 503，不查 DB', async () => {
    delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    const { POST } = await import('@/app/api/internal/apikey/verify/route');
    const res = await POST(postKeyHash({ keyHash: 'a'.repeat(64) }, { 'Content-Type': 'application/json' }));
    expect(res.status).toBe(503);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('缺少签名头 → 401', async () => {
    process.env.ASTER_PLAN_GATE_HMAC_KEY = TEST_KEY;
    const { POST } = await import('@/app/api/internal/apikey/verify/route');
    const res = await POST(postKeyHash({ keyHash: 'a'.repeat(64) }, { 'Content-Type': 'application/json' }));
    expect(res.status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('坏签名 → 401，不查 DB', async () => {
    process.env.ASTER_PLAN_GATE_HMAC_KEY = TEST_KEY;
    const bad = signedHeaders('wrong-key');
    const { POST } = await import('@/app/api/internal/apikey/verify/route');
    const res = await POST(postKeyHash({ keyHash: 'a'.repeat(64) }, bad));
    expect(res.status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

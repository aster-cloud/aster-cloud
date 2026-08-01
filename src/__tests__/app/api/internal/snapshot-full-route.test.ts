import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac, createHash } from 'node:crypto';

/**
 * /api/internal/snapshot/full 路由级回归：
 *  - limit 参数边界校验（NaN/0/负数/超界 → 400，且不查 DB）
 *  - active key 过滤下推到 SQL（where 同时含 isNull(revokedAt) + inArray(userId)）
 *  - fail-closed：HMAC 密钥未配置 → 503（audit #168）；坏签名 → 401
 *
 * 输入校验用例携带合法签名以隔离校验逻辑。
 */

const { mockUsersFindMany, mockApiKeysFindMany } = vi.hoisted(() => ({
  mockUsersFindMany: vi.fn(),
  mockApiKeysFindMany: vi.fn(),
}));

// drizzle 操作符替换成可断言的标记对象，避免依赖其不透明内部结构。
vi.mock('drizzle-orm', () => ({
  gt: (col: unknown, val: unknown) => ({ op: 'gt', col, val }),
  asc: (col: unknown) => ({ op: 'asc', col }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  inArray: (col: unknown, vals: unknown) => ({ op: 'inArray', col, vals }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      users: { findMany: mockUsersFindMany },
      apiKeys: { findMany: mockApiKeysFindMany },
    },
  },
  users: { id: 'users.id' },
  apiKeys: { revokedAt: 'apiKeys.revokedAt', userId: 'apiKeys.userId' },
}));

vi.mock('@/lib/plans', () => ({
  getEffectiveLimits: () => ({ apiCalls: 1000 }),
}));

const originalKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
const TEST_KEY = 'test-shared-hmac-key';
const PATH = '/api/internal/snapshot/full';

// ★v2 签名（绑定 nonce + bodyHash）。GET 无 body，bodyHash 取空串的 sha256。
// v1 已于 2026-08-01 默认关闭——它不绑 body/nonce，可在时钟窗内换 body 重放。
function signedHeaders(key: string): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = `n-${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2)}`;
  const bodyHash = createHash('sha256').update('').digest('hex');
  const sig = createHmac('sha256', key)
    .update(`GET\n${PATH}\n${ts}\n${nonce}\n${bodyHash}`)
    .digest('hex');
  return { 'X-Aster-Timestamp': ts, 'X-Aster-Nonce': nonce, 'X-Internal-Signature': sig };
}

function makeReq(query: string, headers?: Record<string, string>): Request {
  return new Request(`http://cloud.test${PATH}${query}`, {
    headers: headers ?? signedHeaders(TEST_KEY),
  });
}

describe('GET /api/internal/snapshot/full — limit 校验', () => {
  beforeEach(() => {
    vi.resetModules();
    mockUsersFindMany.mockReset().mockResolvedValue([]);
    mockApiKeysFindMany.mockReset().mockResolvedValue([]);
    process.env.ASTER_PLAN_GATE_HMAC_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it.each(['abc', '0', '-5', '5001', '5.5', '', 'NaN', '  '])(
    'limit=%s → 400 且不查 DB',
    async (bad) => {
      const { GET } = await import('@/app/api/internal/snapshot/full/route');
      const res = await GET(makeReq(`?limit=${encodeURIComponent(bad)}`));
      expect(res.status).toBe(400);
      expect(mockUsersFindMany).not.toHaveBeenCalled();
    },
  );

  it('limit=1e3 → 视为 1000（Number 接受指数记法的有限整数）', async () => {
    const { GET } = await import('@/app/api/internal/snapshot/full/route');
    const res = await GET(makeReq('?limit=1e3'));
    expect(res.status).toBe(200);
    expect(mockUsersFindMany.mock.calls[0][0].limit).toBe(1000);
  });

  it('limit 缺省 → 200，使用默认 1000', async () => {
    const { GET } = await import('@/app/api/internal/snapshot/full/route');
    const res = await GET(makeReq(''));
    expect(res.status).toBe(200);
    expect(mockUsersFindMany).toHaveBeenCalledTimes(1);
    expect(mockUsersFindMany.mock.calls[0][0].limit).toBe(1000);
  });

  it('limit=2000 合法 → 透传', async () => {
    const { GET } = await import('@/app/api/internal/snapshot/full/route');
    const res = await GET(makeReq('?limit=2000'));
    expect(res.status).toBe(200);
    expect(mockUsersFindMany.mock.calls[0][0].limit).toBe(2000);
  });

  it('active key 过滤下推 SQL：where 含 isNull(revokedAt) + inArray(userId)', async () => {
    mockUsersFindMany.mockResolvedValue([
      { id: 'u1', plan: 'free', priceLockedAt: null, legacyTier: null,
        subscriptionStatus: null, aiBannedUntil: null, gracePeriodEndsAt: null },
    ]);
    const { GET } = await import('@/app/api/internal/snapshot/full/route');
    await GET(makeReq('?limit=1000'));

    expect(mockApiKeysFindMany).toHaveBeenCalledTimes(1);
    const where = mockApiKeysFindMany.mock.calls[0][0].where;
    expect(where.op).toBe('and');
    const ops = where.args.map((a: { op: string }) => a.op);
    expect(ops).toContain('isNull');
    expect(ops).toContain('inArray');
    // 列级断言：确保过滤打在正确的列上（防止未来误改成别的列）。
    const isNullArg = where.args.find((a: { op: string }) => a.op === 'isNull');
    expect(isNullArg.col).toBe('apiKeys.revokedAt');
    const inArrayArg = where.args.find((a: { op: string }) => a.op === 'inArray');
    expect(inArrayArg.col).toBe('apiKeys.userId');
    expect(inArrayArg.vals).toEqual(['u1']);
  });

  it('无 user → 跳过 apiKeys 查询（空 userIds 不下推空 inArray）', async () => {
    mockUsersFindMany.mockResolvedValue([]);
    const { GET } = await import('@/app/api/internal/snapshot/full/route');
    await GET(makeReq('?limit=1000'));
    expect(mockApiKeysFindMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/internal/snapshot/full — fail-closed HMAC (audit #168)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockUsersFindMany.mockReset().mockResolvedValue([]);
    mockApiKeysFindMany.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    else process.env.ASTER_PLAN_GATE_HMAC_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it('HMAC 密钥未配置 → 503，不查 DB', async () => {
    delete process.env.ASTER_PLAN_GATE_HMAC_KEY;
    const { GET } = await import('@/app/api/internal/snapshot/full/route');
    const res = await GET(makeReq('?limit=1000', {}));
    expect(res.status).toBe(503);
    expect(mockUsersFindMany).not.toHaveBeenCalled();
  });

  it('坏签名 → 401，不查 DB', async () => {
    process.env.ASTER_PLAN_GATE_HMAC_KEY = TEST_KEY;
    const { GET } = await import('@/app/api/internal/snapshot/full/route');
    const res = await GET(makeReq('?limit=1000', signedHeaders('wrong-key')));
    expect(res.status).toBe(401);
    expect(mockUsersFindMany).not.toHaveBeenCalled();
  });
});

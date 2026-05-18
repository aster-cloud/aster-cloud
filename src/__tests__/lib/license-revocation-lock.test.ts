// withRevocationLock + refreshLicenseRevocationCache 并发锁行为：
//   - 拿不到 lock 立即返回 'concurrent-refresh-in-progress'，不阻塞
//   - 拿到 lock 后正常进入 fetch + upsert 流程
//   - 锁随 transaction 结束自动释放（无需手动 unlock）
//
// 不真连 PG，用 vi.mock 控制 db.transaction 返回 pg_try_advisory_xact_lock 结果

import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted 解决 vi.mock 工厂回调引用未定义变量的问题
const mocks = vi.hoisted(() => ({
  txExecute: vi.fn(),
  findFirstMock: vi.fn(),
}));

vi.mock('@/lib/prisma', async () => {
  const real = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...real,
    db: {
      query: {
        licenseCache: {
          findFirst: mocks.findFirstMock,
        },
      },
      transaction: async <T>(
        fn: (tx: { execute: typeof mocks.txExecute }) => Promise<T>,
      ): Promise<T> => {
        return fn({ execute: mocks.txExecute });
      },
      execute: vi.fn(),
      insert: vi.fn(),
    },
  };
});

const { txExecute, findFirstMock } = mocks;

import { refreshLicenseRevocationCache, withRevocationLock } from '@/lib/license-revocation';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withRevocationLock', () => {
  it('拿到 lock 时执行 fn 并返回结果', async () => {
    txExecute.mockResolvedValueOnce({ rows: [{ locked: true }] });
    const result = await withRevocationLock(async () => 'fn-result');
    expect(result).toBe('fn-result');
  });

  it('pg_try_advisory_xact_lock=false 时 throw ConcurrentRefreshInProgressError', async () => {
    txExecute.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const fn = vi.fn();
    await expect(withRevocationLock(fn)).rejects.toThrow('concurrent-refresh-in-progress');
    expect(fn).not.toHaveBeenCalled();
  });

  it('返回数组形式（不带 rows 包装）也能正确读取', async () => {
    txExecute.mockResolvedValueOnce([{ locked: true }]);
    const result = await withRevocationLock(async () => 'ok');
    expect(result).toBe('ok');
  });
});

describe('refreshLicenseRevocationCache concurrent-refresh', () => {
  it('cache 不存在 → 不需要 lock，立即返回 missing-cache', async () => {
    findFirstMock.mockResolvedValueOnce(undefined);
    const result = await refreshLicenseRevocationCache();
    expect(result.outcome).toBe('missing-cache');
    expect(txExecute).not.toHaveBeenCalled();
  });

  it('air-gapped → 不需要 lock，立即返回 air-gapped', async () => {
    findFirstMock.mockResolvedValueOnce({
      licenseId: 'lic_1',
      licenseKeyHash: 'h',
      payloadJson: {
        schemaVersion: 2,
        licenseId: 'lic_1',
        keyId: 'k',
        customer: 'C',
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        seatLimit: 10,
        tier: 'enterprise',
        features: [],
        sku: 'air-gapped',
        licenseTerm: 'five-year',
        deploymentBinding: null,
      },
      signingKeyId: 'k',
      verifiedAt: new Date(),
      revocationVersion: null,
      revocationPublishedAt: null,
      revocationFetchedAt: null,
      lastSuccessfulRevocationCheckAt: null,
      lastRevocationError: null,
      isRevoked: false,
      revokedAt: null,
      revokedReason: null,
    });
    const result = await refreshLicenseRevocationCache();
    expect(result.outcome).toBe('air-gapped');
    expect(txExecute).not.toHaveBeenCalled();
  });

  it('lock 拿不到 → concurrent-refresh-in-progress（不调 fetch）', async () => {
    findFirstMock.mockResolvedValueOnce({
      licenseId: 'lic_1',
      licenseKeyHash: 'h',
      payloadJson: {
        schemaVersion: 2,
        licenseId: 'lic_1',
        keyId: 'k',
        customer: 'C',
        issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        seatLimit: 10,
        tier: 'enterprise',
        features: [],
        sku: 'standard',
        licenseTerm: 'annual',
        deploymentBinding: null,
        revocationCheckUrl: 'https://license.example/revoked.json',
      },
      signingKeyId: 'k',
      verifiedAt: new Date(),
      revocationVersion: BigInt(5),
      revocationPublishedAt: null,
      revocationFetchedAt: null,
      lastSuccessfulRevocationCheckAt: null,
      lastRevocationError: null,
      isRevoked: false,
      revokedAt: null,
      revokedReason: null,
    });
    txExecute.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const fetchFn = vi.fn();
    const result = await refreshLicenseRevocationCache({ fetchFn });
    expect(result.outcome).toBe('concurrent-refresh-in-progress');
    expect(result.version).toBe(BigInt(5));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

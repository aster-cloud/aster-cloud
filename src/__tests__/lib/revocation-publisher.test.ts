// publishRevocationManifest 行为：
//   - 从 PG sequence 分配单调 version
//   - 收集 revokedLicenses → canonical signed doc
//   - signFn 可注入；默认 nodeCryptoSignFn 需要 LICENSE_REVOCATION_PRIVATE_KEY_PKCS8
//   - 写入 RevocationPublication 表（signedDoc 全文 + signature）

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  findMany: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock('@/lib/prisma', async () => {
  const real = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...real,
    db: {
      execute: mocks.execute,
      query: {
        revokedLicenses: { findMany: mocks.findMany },
      },
      insert: () => ({
        values: mocks.insertValues,
      }),
    },
  };
});

import { publishRevocationManifest } from '@/lib/revocation-publisher';
import { canonicalizeRevocationDoc } from '@/lib/license-revocation';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('publishRevocationManifest', () => {
  it('分配新 version + 收集 revoked 列表 + 调用 signFn + 写入表', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ version: BigInt(42) }] });
    mocks.findMany.mockResolvedValueOnce([
      {
        licenseId: 'lic_test_1',
        revokedAt: new Date('2026-06-10T00:00:00.000Z'),
        reason: 'security',
      },
    ]);
    mocks.insertValues.mockResolvedValueOnce(undefined);

    const signFn = vi.fn(async (msg: Uint8Array) => {
      // 验证签名输入 = canonical(unsigned doc)
      expect(msg.length).toBeGreaterThan(0);
      return new Uint8Array(64).fill(7); // 模拟 64 字节签名
    });

    const result = await publishRevocationManifest({
      now: new Date('2026-06-15T12:00:00.000Z'),
      signFn,
    });

    expect(result.version).toBe(BigInt(42));
    expect(signFn).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);

    // signFn 收到的 message 应是 canonical JSON（无 signature 字段、按 key 字母序）
    const signedMessage = signFn.mock.calls[0][0];
    const decoded = new TextDecoder().decode(signedMessage);
    expect(decoded).toContain('"schemaVersion":1');
    expect(decoded).toContain('"version":42');
    expect(decoded).not.toContain('"signature"');

    // 写入的 row 包含 signed_doc 全文 + signature
    const writtenRow = mocks.insertValues.mock.calls[0][0];
    expect(writtenRow.version).toBe(BigInt(42));
    expect(writtenRow.revokedCount).toBe(1);
    expect(writtenRow.signature).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    const parsed = JSON.parse(writtenRow.signedDoc);
    expect(parsed.signature).toBe(writtenRow.signature);
  });

  it('empty revocation list → 仍发布（revokedCount=0）', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ version: BigInt(1) }] });
    mocks.findMany.mockResolvedValueOnce([]);
    mocks.insertValues.mockResolvedValueOnce(undefined);

    const signFn = vi.fn(async () => new Uint8Array(64));
    const result = await publishRevocationManifest({
      now: new Date('2026-01-01T00:00:00.000Z'),
      signFn,
    });

    expect(result.version).toBe(BigInt(1));
    expect(mocks.insertValues.mock.calls[0][0].revokedCount).toBe(0);
  });

  it('PG sequence 返回 undefined → throw', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    await expect(
      publishRevocationManifest({ signFn: async () => new Uint8Array(64) }),
    ).rejects.toThrow('failed to allocate revocation publication version');
  });

  it('canonical 与 verifier 端 canonicalize 一致（round-trip）', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ version: BigInt(5) }] });
    mocks.findMany.mockResolvedValueOnce([
      {
        licenseId: 'lic_a',
        revokedAt: new Date('2026-06-10T00:00:00.000Z'),
        reason: 'fraud',
      },
    ]);
    mocks.insertValues.mockResolvedValueOnce(undefined);

    const signFn = vi.fn(async (msg: Uint8Array) => msg.slice(0, 64)); // 返回前 64 字节作为伪签名
    await publishRevocationManifest({
      now: new Date('2026-06-15T00:00:00.000Z'),
      signFn,
    });

    const writtenSignedDoc = JSON.parse(
      mocks.insertValues.mock.calls[0][0].signedDoc,
    );
    // verifier 端 canonicalize 必须和 publisher 端产生相同 bytes
    const replayCanonical = canonicalizeRevocationDoc(writtenSignedDoc);
    const publisherCanonical = signFn.mock.calls[0][0];
    // canonicalize 应剥离 signature 后比对相等
    expect(new TextDecoder().decode(replayCanonical)).toBe(
      new TextDecoder().decode(publisherCanonical),
    );
  });
});

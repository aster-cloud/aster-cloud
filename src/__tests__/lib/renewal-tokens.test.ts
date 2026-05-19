// renewal-tokens unit tests.
//
// Strategy: mock @/lib/prisma to expose just the table + the minimum
// query/insert/update surface the module touches. Avoids needing a
// running Postgres for unit tier.
//
// Covered:
//   - mintRenewalToken: returns 43-char base64url raw + correct expiresAt;
//                       inserts hash (not raw) into store
//   - verifyRenewalToken: not-found / expired / already-consumed / valid
//   - verifyRenewalToken: rejects malformed (too short/long) before hitting DB
//   - markTokenConsumed: stamps consumedAt; returns null on race
//   - markTokenEmailSent: stamps emailSentAt
//   - hashRenewalToken: stable across calls

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeRow {
  tokenHash: string;
  licenseId: string;
  customer: string;
  oldDeploymentBinding: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
  emailSentAt?: Date | null;
  consumedAt?: Date | null;
}

const rows = new Map<string, FakeRow>();

const mocks = {
  insertValues: vi.fn(async (row: FakeRow) => {
    rows.set(row.tokenHash, { ...row });
  }),
  findFirstByHash: vi.fn(async (hash: string) => rows.get(hash) ?? null),
  updateReturning: vi.fn(async (hash: string, fields: Partial<FakeRow>) => {
    const row = rows.get(hash);
    if (!row) return [];
    if (fields.consumedAt && row.consumedAt) return []; // race-guard simulation
    Object.assign(row, fields);
    return [{ ...row }];
  }),
  update: vi.fn(async (hash: string, fields: Partial<FakeRow>) => {
    const row = rows.get(hash);
    if (row) Object.assign(row, fields);
  }),
};

vi.mock('@/lib/prisma', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...schema,
    db: {
      insert: () => ({ values: mocks.insertValues }),
      update: (table: unknown) => {
        // Builder must support BOTH:
        //   .where(...).returning()  → markTokenConsumed (atomic update + read)
        //   await .where(...)        → markTokenEmailSent (fire-and-forget)
        // So .where() returns a thenable that also has .returning().
        void table;
        return {
          set(fields: Partial<FakeRow>) {
            return {
              where(arg: unknown) {
                const a = arg as { __hash?: string; __requireUnconsumed?: boolean };
                const hash = a.__hash;
                // 单次执行 + 缓存结果。drizzle 既可能 `await .where(...)`（fire-and-forget
                // update，比如 markTokenEmailSent），也可能 `.where(...).returning()`
                // （atomic update + read，比如 markTokenConsumed）。如果两条路径都各
                // 自调用 doUpdate，第二次 row 已被改 → race-guard 误判返回 []。
                // 用 memo 化避免重复 apply。
                let memo: Promise<FakeRow[]> | null = null;
                const run = () => {
                  if (memo) return memo;
                  memo = (async () => {
                    if (!hash) return [];
                    const row = rows.get(hash);
                    if (!row) return [];
                    if (a.__requireUnconsumed === true && row.consumedAt) return [];
                    Object.assign(row, fields);
                    return [{ ...row }];
                  })();
                  return memo;
                };
                const thenable = {
                  then: (onFulfilled: (v: FakeRow[]) => unknown, onRejected?: (e: unknown) => unknown) =>
                    run().then(onFulfilled, onRejected),
                  catch: (onRejected: (e: unknown) => unknown) => run().catch(onRejected),
                  finally: (cb: () => void) => run().finally(cb),
                  returning: () => run(),
                };
                return thenable;
              },
            };
          },
        };
      },
      query: {
        renewalTokens: {
          findFirst: async ({ where }: { where: { __hash: string } }) =>
            mocks.findFirstByHash(where.__hash),
        },
      },
    },
  };
});

// drizzle helpers used by renewal-tokens — return simple sentinels so
// our mock can inspect them. Real query semantics aren't exercised here;
// the integration test covers actual SQL.
vi.mock('drizzle-orm', async () => {
  const real = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...real,
    eq: (_col: unknown, value: string) => ({ __hash: value }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
      // Detect markTokenConsumed: pattern is `${tokenHash} = ${hash} AND ${consumedAt} IS NULL`
      const hash = values.find((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v as string));
      const isUnconsumed = strings.join('').includes('IS NULL');
      return { __hash: hash as string, __requireUnconsumed: isUnconsumed };
    },
  };
});

import {
  mintRenewalToken,
  verifyRenewalToken,
  markTokenConsumed,
  markTokenEmailSent,
  hashRenewalToken,
} from '@/lib/renewal-tokens';

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
});

describe('mintRenewalToken', () => {
  it('inserts the hash, returns raw + expiresAt', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const minted = await mintRenewalToken({
      licenseId: 'lic_1',
      customer: 'Acme',
      oldDeploymentBinding: { deploymentId: 'a'.repeat(64), deploymentLabel: 'prod' },
      now,
    });
    expect(minted.raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(minted.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(minted.expiresAt.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    expect(rows.get(minted.hash)?.licenseId).toBe('lic_1');
    expect(rows.get(minted.hash)?.tokenHash).toBe(minted.hash);
    // Raw value never persisted
    for (const row of rows.values()) {
      expect((row as unknown as Record<string, unknown>).raw).toBeUndefined();
    }
  });

  it('honors custom ttlMs', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const minted = await mintRenewalToken({
      licenseId: 'lic_2',
      customer: 'C',
      oldDeploymentBinding: { deploymentId: 'b'.repeat(64), deploymentLabel: 'q' },
      now,
      ttlMs: 60_000,
    });
    expect(minted.expiresAt.toISOString()).toBe('2026-05-19T00:01:00.000Z');
  });
});

describe('verifyRenewalToken', () => {
  it('rejects malformed input without DB lookup', async () => {
    const a = await verifyRenewalToken('');
    const b = await verifyRenewalToken('short');
    expect(a.kind).toBe('not-found');
    expect(b.kind).toBe('not-found');
    expect(mocks.findFirstByHash).not.toHaveBeenCalled();
  });

  it('returns not-found for unknown raw', async () => {
    const outcome = await verifyRenewalToken('x'.repeat(43));
    expect(outcome.kind).toBe('not-found');
  });

  it('returns valid for fresh row', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const minted = await mintRenewalToken({
      licenseId: 'lic_3',
      customer: 'C',
      oldDeploymentBinding: { deploymentId: 'c'.repeat(64), deploymentLabel: 'q' },
      now,
    });
    const outcome = await verifyRenewalToken(minted.raw, { now });
    expect(outcome.kind).toBe('valid');
  });

  it('returns expired when past TTL', async () => {
    const past = new Date('2026-05-01T00:00:00Z');
    const minted = await mintRenewalToken({
      licenseId: 'lic_4',
      customer: 'C',
      oldDeploymentBinding: { deploymentId: 'd'.repeat(64), deploymentLabel: 'q' },
      now: past,
    });
    const outcome = await verifyRenewalToken(minted.raw, { now: new Date('2026-06-01T00:00:00Z') });
    expect(outcome.kind).toBe('expired');
  });

  it('returns already-consumed after consume', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const minted = await mintRenewalToken({
      licenseId: 'lic_5',
      customer: 'C',
      oldDeploymentBinding: { deploymentId: 'e'.repeat(64), deploymentLabel: 'q' },
      now,
    });
    await markTokenConsumed(minted.raw, { now });
    const outcome = await verifyRenewalToken(minted.raw, { now });
    expect(outcome.kind).toBe('already-consumed');
  });
});

describe('markTokenConsumed', () => {
  it('stamps consumedAt and returns row', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const minted = await mintRenewalToken({
      licenseId: 'lic_6',
      customer: 'C',
      oldDeploymentBinding: { deploymentId: 'f'.repeat(64), deploymentLabel: 'q' },
      now,
    });
    const result = await markTokenConsumed(minted.raw, { now });
    expect(result).not.toBeNull();
    expect(result?.consumedAt?.toISOString()).toBe(now.toISOString());
  });

  it('returns null on race (double-click)', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const minted = await mintRenewalToken({
      licenseId: 'lic_7',
      customer: 'C',
      oldDeploymentBinding: { deploymentId: '7'.repeat(64), deploymentLabel: 'q' },
      now,
    });
    const first = await markTokenConsumed(minted.raw, { now });
    expect(first).not.toBeNull();
    const second = await markTokenConsumed(minted.raw, { now });
    expect(second).toBeNull();
  });
});

describe('markTokenEmailSent', () => {
  it('sets emailSentAt by hash', async () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const minted = await mintRenewalToken({
      licenseId: 'lic_8',
      customer: 'C',
      oldDeploymentBinding: { deploymentId: '8'.repeat(64), deploymentLabel: 'q' },
      now,
    });
    await markTokenEmailSent(minted.hash, { now });
    expect(rows.get(minted.hash)?.emailSentAt?.toISOString()).toBe(now.toISOString());
  });
});

describe('hashRenewalToken', () => {
  it('is deterministic', () => {
    expect(hashRenewalToken('abc')).toBe(hashRenewalToken('abc'));
  });
  it('differs for different inputs', () => {
    expect(hashRenewalToken('abc')).not.toBe(hashRenewalToken('abd'));
  });
});

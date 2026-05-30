/**
 * Service-layer tests for bulkAddUserVocabularyTerms (B10).
 *
 * Reuses the chain-mock pattern from domain-vocabulary.test.ts so the
 * fluent Drizzle calls (select/insert/transaction) are exercised against
 * predictable resolved values. Focus is on the rollup arithmetic and the
 * quota cap path because the per-row machinery is shared with the
 * single-term add we already covered.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ThenableChain {
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  then: (resolve: (value: unknown) => void) => void;
}

function makeChain(result: unknown): ThenableChain {
  const chain = {} as ThenableChain;
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.offset = vi.fn().mockReturnValue(chain);
  chain.then = (resolve) => resolve(result);
  return chain;
}

const hoisted = vi.hoisted(() => {
  const transaction = vi.fn();
  const select = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();
  const findFirst = vi.fn();
  return { transaction, select, insert, update, findFirst };
});

vi.mock('@/lib/prisma', () => {
  const tableMock = new Proxy(
    {},
    {
      get: () => ({}),
    },
  );
  return {
    db: {
      transaction: hoisted.transaction,
      select: hoisted.select,
      insert: hoisted.insert,
      update: hoisted.update,
      query: { domainTerms: { findFirst: hoisted.findFirst } },
    },
    domainTerms: tableMock,
    userDomainTerms: tableMock,
    lexiconBulkJobs: tableMock,
  };
});

vi.mock('@/lib/usage', () => ({ getLexiconQuota: vi.fn() }));

vi.mock('@/lib/audit-log', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  BULK_SYNC_MAX_ROWS,
  bulkAddUserVocabularyTerms,
  type TermInput,
} from '@/lib/domain-vocabulary';
import { getLexiconQuota } from '@/lib/usage';

const baseRow: TermInput = {
  domain: 'finance.loan',
  locale: 'en-US',
  kind: 'struct',
  canonical: 'Loan',
  localized: 'Loan',
};

const selectQueue: unknown[] = [];

function queueSelect(result: unknown) {
  selectQueue.push(result);
}

function makeInsertChain(returning: unknown[]) {
  const ret = vi.fn().mockResolvedValue(returning);
  const onConflict = vi.fn().mockReturnValue({ returning: ret });
  const valuesFn = vi
    .fn()
    .mockReturnValue({ onConflictDoNothing: onConflict, returning: ret });
  return {
    chain: { values: valuesFn },
    values: valuesFn,
    returning: ret,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  vi.mocked(getLexiconQuota).mockResolvedValue({
    maxTerms: 5000,
    bulkAsync: true,
    allowed: true,
  });
  hoisted.select.mockImplementation(() => {
    const next = selectQueue.shift() ?? [];
    return makeChain(next);
  });
  hoisted.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    return fn({
      execute: vi.fn().mockResolvedValue(undefined),
      insert: hoisted.insert,
      update: hoisted.update,
      select: hoisted.select,
      query: { domainTerms: { findFirst: hoisted.findFirst } },
    });
  });
});

describe('bulkAddUserVocabularyTerms', () => {
  it('throws validation_failed when the input array is empty', async () => {
    await expect(bulkAddUserVocabularyTerms('user-1', [])).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('throws validation_failed when input exceeds the sync cap', async () => {
    const rows = Array.from({ length: BULK_SYNC_MAX_ROWS + 1 }, () => baseRow);
    await expect(bulkAddUserVocabularyTerms('user-1', rows)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('throws plan_gate_required when the user cannot use customLexicon', async () => {
    vi.mocked(getLexiconQuota).mockResolvedValue({
      maxTerms: 0,
      bulkAsync: false,
      allowed: false,
    });
    await expect(
      bulkAddUserVocabularyTerms('user-1', [baseRow]),
    ).rejects.toMatchObject({ code: 'plan_gate_required' });
  });

  it('counts add vs reused for two distinct rows', async () => {
    // Quota check before chunk
    queueSelect([{ count: 0 }]);
    // Per-row: term upsert returning, then link insert returning. First row
    // inserts a brand-new term (added); second row gets an empty array back
    // (existing term reused) and falls through the SELECT cache lookup.
    const termInsert1 = makeInsertChain([{ id: 'term-1' }]);
    const linkInsert1 = makeInsertChain([{ id: 'link-1' }]);
    const termInsert2 = makeInsertChain([]); // ON CONFLICT DO NOTHING — already existed
    const linkInsert2 = makeInsertChain([{ id: 'link-2' }]);
    hoisted.insert
      .mockReturnValueOnce(termInsert1.chain)
      .mockReturnValueOnce(linkInsert1.chain)
      .mockReturnValueOnce(termInsert2.chain)
      .mockReturnValueOnce(linkInsert2.chain)
      // The job-row persistence at the end of the helper.
      .mockReturnValueOnce(makeInsertChain([]).chain);
    hoisted.findFirst.mockResolvedValueOnce({ id: 'existing-term' });

    const result = await bulkAddUserVocabularyTerms('user-1', [
      baseRow,
      { ...baseRow, canonical: 'Borrower', localized: 'Borrower' },
    ]);

    expect(result.status).toBe('completed');
    expect(result.rowCount).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.rollup.added).toBe(1);
    expect(result.rollup.reused).toBe(1);
    expect(result.rollup.skipped).toBe(0);
    expect(result.rollup.errorCount).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('skips trailing rows that would exceed the plan quota', async () => {
    vi.mocked(getLexiconQuota).mockResolvedValue({
      maxTerms: 2,
      bulkAsync: false,
      allowed: true,
    });
    // Pre-chunk quota count: user already has 1, so only 1 of the 3 rows
    // can land — the other two should be reported as quota_exceeded skips.
    queueSelect([{ count: 1 }]);
    const termInsert = makeInsertChain([{ id: 'term-1' }]);
    const linkInsert = makeInsertChain([{ id: 'link-1' }]);
    hoisted.insert
      .mockReturnValueOnce(termInsert.chain)
      .mockReturnValueOnce(linkInsert.chain)
      .mockReturnValueOnce(makeInsertChain([]).chain); // job row

    const result = await bulkAddUserVocabularyTerms('user-1', [
      baseRow,
      { ...baseRow, canonical: 'Borrower', localized: 'Borrower' },
      { ...baseRow, canonical: 'Lender', localized: 'Lender' },
    ]);

    expect(result.rollup.added).toBe(1);
    expect(result.rollup.skipped).toBe(2);
    expect(result.rollup.errorCount).toBe(2);
    const codes = result.errors.map((e) => e.code);
    expect(codes.filter((c) => c === 'quota_exceeded')).toHaveLength(2);
  });

  it('reports row-level validation errors without aborting valid rows', async () => {
    // Row 0 is invalid (non-ASCII canonical); row 1 is valid.
    queueSelect([{ count: 0 }]);
    const termInsert = makeInsertChain([{ id: 'term-1' }]);
    const linkInsert = makeInsertChain([{ id: 'link-1' }]);
    hoisted.insert
      .mockReturnValueOnce(termInsert.chain)
      .mockReturnValueOnce(linkInsert.chain)
      .mockReturnValueOnce(makeInsertChain([]).chain); // job row

    const result = await bulkAddUserVocabularyTerms('user-1', [
      { ...baseRow, canonical: '贷款' },
      { ...baseRow, canonical: 'Lender', localized: 'Lender' },
    ]);

    expect(result.rollup.added).toBe(1);
    expect(result.rollup.errorCount).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 0, code: 'validation_failed' });
  });
});

/**
 * Snapshot service tests for B12. Focused on:
 *   - createSnapshotsForOwner returns one ref per (domain, locale) group
 *   - dedup hits bump refCount instead of inserting a new row
 *   - rollback reactivates missing termIds and soft-deletes extras
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  transaction: vi.fn(),
  selectChain: vi.fn(),
  insertValues: vi.fn().mockResolvedValue(undefined),
  insert: vi.fn(() => ({ values: hoisted.insertValues })),
  updateWhere: vi.fn().mockResolvedValue(undefined),
  updateSet: vi.fn(() => ({ where: hoisted.updateWhere })),
  update: vi.fn(() => ({ set: hoisted.updateSet })),
  findFirstSnapshot: vi.fn(),
  findFirstUdt: vi.fn(),
  findFirstDt: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const tableProxy = new Proxy({}, { get: () => ({}) });
  return {
    db: {
      transaction: hoisted.transaction,
      select: hoisted.selectChain,
      insert: hoisted.insert,
      update: hoisted.update,
      query: {
        userVocabularySnapshots: { findFirst: hoisted.findFirstSnapshot },
        userDomainTerms: { findFirst: hoisted.findFirstUdt },
        domainTerms: { findFirst: hoisted.findFirstDt },
      },
    },
    domainTerms: tableProxy,
    policyVersions: tableProxy,
    userDomainTerms: tableProxy,
    userVocabularySnapshots: tableProxy,
  };
});

vi.mock('@/lib/audit-log', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  createSnapshotsForOwner,
  rollbackToSnapshot,
} from '@/lib/domain-vocabulary-snapshot';
import { VocabularyError } from '@/lib/domain-vocabulary';

interface ThenChain {
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  then: (resolve: (v: unknown) => void) => void;
}

function makeChain(result: unknown): ThenChain {
  const chain = {} as ThenChain;
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.then = (resolve) => resolve(result);
  return chain;
}

const selectQueue: unknown[] = [];

function queueSelect(result: unknown) {
  selectQueue.push(result);
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  hoisted.selectChain.mockImplementation(() => makeChain(selectQueue.shift() ?? []));
  hoisted.insert.mockImplementation(() => ({ values: hoisted.insertValues }));
  hoisted.insertValues.mockResolvedValue(undefined);
  hoisted.update.mockImplementation(() => ({ set: hoisted.updateSet }));
  hoisted.updateSet.mockImplementation(() => ({ where: hoisted.updateWhere }));
  hoisted.updateWhere.mockResolvedValue(undefined);
  hoisted.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      execute: vi.fn().mockResolvedValue(undefined),
      insert: hoisted.insert,
      update: hoisted.update,
      select: hoisted.selectChain,
      query: {
        userVocabularySnapshots: { findFirst: hoisted.findFirstSnapshot },
        userDomainTerms: { findFirst: hoisted.findFirstUdt },
        domainTerms: { findFirst: hoisted.findFirstDt },
      },
    }),
  );
});

describe('createSnapshotsForOwner', () => {
  it('returns no refs when the user has no active vocab', async () => {
    queueSelect([]); // active link join → empty

    const refs = await createSnapshotsForOwner({ ownerType: 'user', ownerId: 'user-1' });

    expect(refs).toEqual([]);
    expect(hoisted.transaction).not.toHaveBeenCalled();
  });

  it('inserts one snapshot per (domain, locale) group on first publish', async () => {
    queueSelect([
      {
        termId: 'term-a',
        domain: 'finance.loan',
        locale: 'en-US',
        kind: 'struct',
        canonical: 'Loan',
        localized: 'Loan',
        parentCanonical: null,
        aliases: [],
        description: null,
      },
      {
        termId: 'term-b',
        domain: 'finance.loan',
        locale: 'zh-CN',
        kind: 'struct',
        canonical: 'Loan',
        localized: '贷款',
        parentCanonical: null,
        aliases: [],
        description: null,
      },
    ]);
    // Two groups → two inner transactions → for each, queue:
    //   1) existing-snapshot lookup → undefined
    //   2) next-version max query → []
    queueSelect([{ max: null }]);
    queueSelect([{ max: null }]);
    hoisted.findFirstSnapshot.mockResolvedValue(undefined);

    const refs = await createSnapshotsForOwner({ ownerType: 'user', ownerId: 'user-1' });

    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.locale).sort()).toEqual(['en-US', 'zh-CN']);
    expect(hoisted.insert).toHaveBeenCalled();
  });

  it('bumps refCount on dedup hit instead of inserting again', async () => {
    queueSelect([
      {
        termId: 'term-a',
        domain: 'finance.loan',
        locale: 'en-US',
        kind: 'struct',
        canonical: 'Loan',
        localized: 'Loan',
        parentCanonical: null,
        aliases: [],
        description: null,
      },
    ]);
    hoisted.findFirstSnapshot.mockResolvedValueOnce({ id: 'snap-existing' });

    const refs = await createSnapshotsForOwner({ ownerType: 'user', ownerId: 'user-1' });

    expect(refs[0].snapshotId).toBe('snap-existing');
    expect(hoisted.update).toHaveBeenCalled();
    expect(hoisted.insert).not.toHaveBeenCalled();
  });
});

describe('rollbackToSnapshot', () => {
  it('throws not_found when the snapshot is missing or not owned', async () => {
    hoisted.findFirstSnapshot.mockResolvedValue(undefined);

    await expect(rollbackToSnapshot('user-1', 'snap-x')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('throws snapshot_archived when the snapshot is archived', async () => {
    hoisted.findFirstSnapshot.mockResolvedValue({
      id: 'snap-1',
      ownerType: 'user',
      ownerId: 'user-1',
      archivedAt: new Date(),
      termIds: ['t1'],
    });

    await expect(rollbackToSnapshot('user-1', 'snap-1')).rejects.toBeInstanceOf(VocabularyError);
  });

  it('soft-deletes extras and inserts missing termIds within the snapshot scope only', async () => {
    hoisted.findFirstSnapshot.mockResolvedValue({
      id: 'snap-1',
      ownerType: 'user',
      ownerId: 'user-1',
      archivedAt: null,
      domain: 'finance.loan',
      locale: 'en-US',
      termIds: ['t-new'],
    });
    // Inside the transaction:
    //   1) current active rows for the snapshot's scope only → user has t-old
    //      to remove.
    queueSelect([{ id: 'link-old', termId: 't-old' }]);
    // dormant lookup for t-new (scoped) → none → insert path
    hoisted.findFirstUdt.mockResolvedValue(undefined);
    hoisted.findFirstDt.mockResolvedValue({
      domain: 'finance.loan',
      locale: 'en-US',
      kind: 'struct',
    });

    const result = await rollbackToSnapshot('user-1', 'snap-1');

    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    expect(result.unchanged).toBe(0);
  });

  it('refuses to insert a termId that belongs to a different (domain, locale) scope', async () => {
    hoisted.findFirstSnapshot.mockResolvedValue({
      id: 'snap-2',
      ownerType: 'user',
      ownerId: 'user-1',
      archivedAt: null,
      domain: 'finance.loan',
      locale: 'en-US',
      termIds: ['t-wrong-scope'],
    });
    queueSelect([]); // no active rows in this scope
    hoisted.findFirstUdt.mockResolvedValue(undefined); // no dormant in this scope
    hoisted.findFirstDt.mockResolvedValue({
      // Global term row belongs to a different domain/locale; rollback
      // should skip rather than insert into the wrong scope.
      domain: 'insurance.policy',
      locale: 'zh-CN',
      kind: 'struct',
    });

    const result = await rollbackToSnapshot('user-1', 'snap-2');

    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });
});

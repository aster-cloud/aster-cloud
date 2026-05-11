// ensurePersonalTeam 并发幂等防御测试
//
// codex audit Info-4 残留：原实现 read-before-write 在并发 webhook 下可能产生 duplicate team。
// v2.0 加入 slug unique constraint 容错 + race re-read。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  teamMembersFindFirst: vi.fn(),
  usersFindFirst: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  return {
    db: {
      query: {
        teamMembers: { findFirst: mocks.teamMembersFindFirst },
        users: { findFirst: mocks.usersFindFirst },
      },
      insert: mocks.insert,
    },
    users: {},
    teams: {},
    teamMembers: {},
  };
});

import { ensurePersonalTeam } from '@/app/api/stripe/webhook/handlers/_shared';

beforeEach(() => {
  mocks.teamMembersFindFirst.mockReset();
  mocks.usersFindFirst.mockReset();
  mocks.insertValues.mockReset();
  mocks.insert.mockReset();
  mocks.insert.mockReturnValue({ values: mocks.insertValues });
  mocks.insertValues.mockResolvedValue(undefined);
});

describe('ensurePersonalTeam — concurrency-safe idempotency', () => {
  it('skips work when user already owns a team', async () => {
    mocks.teamMembersFindFirst.mockResolvedValueOnce({ teamId: 't-existing' });

    await ensurePersonalTeam('u-1');

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.usersFindFirst).not.toHaveBeenCalled();
  });

  it('inserts team + member when no existing team', async () => {
    mocks.teamMembersFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ name: 'Alice', email: 'a@x' });

    await ensurePersonalTeam('u-2');

    // teams.insert + teamMembers.insert = 2 calls
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });

  it('skips when user record is missing (no orphan team)', async () => {
    mocks.teamMembersFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce(null);

    await ensurePersonalTeam('u-ghost');

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('swallows pg 23505 unique_violation when race-loser sees winner team', async () => {
    // First call: no team exists yet
    mocks.teamMembersFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ name: 'Bob', email: 'b@x' });

    // teams.insert throws unique violation (race winner already inserted same slug)
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint "Team_slug_key"'), {
      code: '23505',
    });
    mocks.insertValues.mockRejectedValueOnce(pgError);

    // Race re-check: now the winner's team is visible
    mocks.teamMembersFindFirst.mockResolvedValueOnce({ teamId: 't-winner' });

    await expect(ensurePersonalTeam('u-race')).resolves.toBeUndefined();
    // Inserted attempted but race resolved gracefully
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('rethrows unique_violation when race re-check still finds no team', async () => {
    mocks.teamMembersFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ name: 'Carol', email: 'c@x' });

    const pgError = Object.assign(new Error('duplicate'), { code: '23505' });
    mocks.insertValues.mockRejectedValueOnce(pgError);
    // Re-check returns nothing → it's a real bug, not a race; rethrow
    mocks.teamMembersFindFirst.mockResolvedValueOnce(undefined);

    await expect(ensurePersonalTeam('u-broken')).rejects.toThrow(/duplicate/);
  });

  it('rethrows non-unique errors immediately', async () => {
    mocks.teamMembersFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ name: 'Dan', email: 'd@x' });

    const otherError = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    mocks.insertValues.mockRejectedValueOnce(otherError);

    await expect(ensurePersonalTeam('u-conn')).rejects.toThrow(/connection/);
    // Should NOT have done a race re-check since this isn't a unique violation
    expect(mocks.teamMembersFindFirst).toHaveBeenCalledTimes(1);
  });

  it('detects unique violation by message when code is missing (drizzle wrapping)', async () => {
    mocks.teamMembersFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ name: 'Eve', email: 'e@x' });

    // Some drivers wrap errors and lose .code; we still match on message
    const wrappedError = new Error('Failed query: duplicate key value violates unique constraint');
    mocks.insertValues.mockRejectedValueOnce(wrappedError);
    mocks.teamMembersFindFirst.mockResolvedValueOnce({ teamId: 't-w' });

    await expect(ensurePersonalTeam('u-wrapped')).resolves.toBeUndefined();
  });
});

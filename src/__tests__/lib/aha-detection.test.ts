// AHA moment detection — PM 02 north-star leading indicator
//
// Behavior: emits audit_logs row with action='aha.first_policy_published'
// the FIRST time a user has an approved policy version. Idempotent thereafter.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditLogsFindFirst: vi.fn(),
  usersFindFirst: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      auditLogs: { findFirst: mocks.auditLogsFindFirst },
      users: { findFirst: mocks.usersFindFirst },
    },
    select: mocks.select,
    insert: mocks.insert,
  },
  users: {},
  policyVersions: {
    createdBy: {},
    status: {},
  },
  auditLogs: {
    userId: {},
    action: {},
  },
}));

import { recordAhaMomentIfFirst } from '@/lib/metrics/aha-detection';

function makeSelectStub(count: number) {
  return {
    from: () => ({
      where: () => Promise.resolve([{ c: count }]),
    }),
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => {
    if (typeof m === 'function' && 'mockReset' in m) m.mockReset();
  });
  mocks.insert.mockReturnValue({ values: mocks.insertValues });
  mocks.insertValues.mockResolvedValue(undefined);
});

describe('recordAhaMomentIfFirst', () => {
  it('records AHA event when user has exactly 1 approved version and no prior AHA', async () => {
    const signedUpAt = new Date('2026-05-10T00:00:00Z');
    const approvedAt = new Date('2026-05-10T06:00:00Z'); // 6h later

    mocks.auditLogsFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ createdAt: signedUpAt });
    mocks.select.mockReturnValueOnce(makeSelectStub(1));

    const result = await recordAhaMomentIfFirst({
      userId: 'u-1',
      policyVersionId: 'v-1',
      approvedAt,
    });

    expect(result).toBe(true);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u-1',
      action: 'aha.first_policy_published',
      resource: 'policy_version',
      resourceId: 'v-1',
      metadata: expect.objectContaining({
        hoursToFirst: 6,
        withinAhaWindow: true,
        ahaWindowHours: 24,
      }),
    }));
  });

  it('flags withinAhaWindow=false when first approval > 24h after signup', async () => {
    const signedUpAt = new Date('2026-05-01T00:00:00Z');
    const approvedAt = new Date('2026-05-05T00:00:00Z'); // 96h later

    mocks.auditLogsFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ createdAt: signedUpAt });
    mocks.select.mockReturnValueOnce(makeSelectStub(1));

    const result = await recordAhaMomentIfFirst({
      userId: 'u-slow',
      policyVersionId: 'v-9',
      approvedAt,
    });

    expect(result).toBe(true);
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        hoursToFirst: 96,
        withinAhaWindow: false,
      }),
    }));
  });

  it('is idempotent: skips when AHA event already exists for this user', async () => {
    mocks.auditLogsFindFirst.mockResolvedValueOnce({ id: 'aha-prev' });

    const result = await recordAhaMomentIfFirst({
      userId: 'u-repeat',
      policyVersionId: 'v-2',
      approvedAt: new Date(),
    });

    expect(result).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.usersFindFirst).not.toHaveBeenCalled();
  });

  it('skips when this is not the first approved version (count > 1)', async () => {
    mocks.auditLogsFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ createdAt: new Date() });
    mocks.select.mockReturnValueOnce(makeSelectStub(5)); // user has 5 prior approvals

    const result = await recordAhaMomentIfFirst({
      userId: 'u-veteran',
      policyVersionId: 'v-late',
      approvedAt: new Date(),
    });

    expect(result).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('returns false when user record is missing (defensive)', async () => {
    mocks.auditLogsFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce(null);

    const result = await recordAhaMomentIfFirst({
      userId: 'u-ghost',
      policyVersionId: 'v-x',
      approvedAt: new Date(),
    });

    expect(result).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('handles sub-hour approvals (rounding)', async () => {
    const signedUpAt = new Date('2026-05-10T00:00:00Z');
    const approvedAt = new Date('2026-05-10T00:30:00Z'); // 0.5h

    mocks.auditLogsFindFirst.mockResolvedValueOnce(undefined);
    mocks.usersFindFirst.mockResolvedValueOnce({ createdAt: signedUpAt });
    mocks.select.mockReturnValueOnce(makeSelectStub(1));

    await recordAhaMomentIfFirst({
      userId: 'u-fast',
      policyVersionId: 'v-f',
      approvedAt,
    });

    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        hoursToFirst: 0.5,
        withinAhaWindow: true,
      }),
    }));
  });
});

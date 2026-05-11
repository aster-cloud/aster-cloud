// Stripe seats reconcile — daily safety net for missed webhooks.
//
// Critical behaviors:
//   - in-sync teams are noted but not touched
//   - missing subscription → no_subscription, skip
//   - small diff → adjust (dry-run respects flag)
//   - large diff (> 5) → skipped_large_diff, alert
//   - aggregate diff > 5% of population → HALT

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  teamsFindMany: vi.fn(),
  usersFindFirst: vi.fn(),
  selectChain: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  stripeRetrieve: vi.fn(),
  stripeUpdate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      teams: { findMany: mocks.teamsFindMany },
      users: { findFirst: mocks.usersFindFirst },
    },
    select: mocks.selectChain,
    insert: mocks.insert,
  },
  teams: {},
  teamMembers: {},
  users: {},
  auditLogs: {},
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: { retrieve: mocks.stripeRetrieve },
    subscriptionItems: { update: mocks.stripeUpdate },
  },
}));

import { reconcileStripeSeats } from '@/lib/stripe-reconcile';

function setupSelectCount(count: number) {
  mocks.selectChain.mockReturnValueOnce({
    from: () => ({ where: () => Promise.resolve([{ count }]) }),
  });
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => {
    if (typeof m === 'function' && 'mockReset' in m) m.mockReset();
  });
  mocks.insert.mockReturnValue({ values: mocks.insertValues });
  mocks.insertValues.mockResolvedValue(undefined);
});

describe('reconcileStripeSeats', () => {
  it('reports zero discrepancies when all teams in sync', async () => {
    mocks.teamsFindMany.mockResolvedValueOnce([{ id: 't1', ownerId: 'u1' }]);
    mocks.usersFindFirst.mockResolvedValueOnce({
      subscriptionId: 'sub_1',
      subscriptionStatus: 'active',
    });
    setupSelectCount(2);
    mocks.stripeRetrieve.mockResolvedValueOnce({
      items: { data: [{ id: 'si_1', quantity: 2 }] },
    });

    const report = await reconcileStripeSeats({ dryRun: false });

    expect(report.scanned).toBe(1);
    expect(report.inSync).toBe(1);
    expect(report.adjusted).toBe(0);
    expect(report.errored).toBe(0);
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
  });

  it('skips teams whose owner has no active subscription', async () => {
    mocks.teamsFindMany.mockResolvedValueOnce([{ id: 't1', ownerId: 'u-free' }]);
    mocks.usersFindFirst.mockResolvedValueOnce({
      subscriptionId: null,
      subscriptionStatus: null,
    });

    const report = await reconcileStripeSeats({ dryRun: false });

    expect(report.scanned).toBe(1);
    expect(report.inSync).toBe(0);
    expect(report.adjusted).toBe(0);
    expect(report.details[0]?.action).toBe('no_subscription');
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
  });

  it('adjusts small discrepancies and writes audit log (non-dry-run)', async () => {
    mocks.teamsFindMany.mockResolvedValueOnce([{ id: 't1', ownerId: 'u1' }]);
    mocks.usersFindFirst.mockResolvedValueOnce({
      subscriptionId: 'sub_1',
      subscriptionStatus: 'active',
    });
    setupSelectCount(3); // 3 members, Stripe says 2
    mocks.stripeRetrieve.mockResolvedValueOnce({
      items: { data: [{ id: 'si_1', quantity: 2 }] },
    });
    mocks.stripeUpdate.mockResolvedValueOnce({});

    const report = await reconcileStripeSeats({ dryRun: false });

    expect(report.adjusted).toBe(1);
    expect(mocks.stripeUpdate).toHaveBeenCalledWith('si_1', {
      quantity: 3,
      proration_behavior: 'create_prorations',
    });
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      action: 'subscription.seats_reconciled',
      metadata: expect.objectContaining({
        teamId: 't1',
        previousQuantity: 2,
        newQuantity: 3,
      }),
    }));
  });

  it('dry-run mode reports but does NOT call Stripe.update', async () => {
    mocks.teamsFindMany.mockResolvedValueOnce([{ id: 't1', ownerId: 'u1' }]);
    mocks.usersFindFirst.mockResolvedValueOnce({
      subscriptionId: 'sub_1',
      subscriptionStatus: 'active',
    });
    setupSelectCount(3);
    mocks.stripeRetrieve.mockResolvedValueOnce({
      items: { data: [{ id: 'si_1', quantity: 2 }] },
    });

    const report = await reconcileStripeSeats({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.adjusted).toBe(1);
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('skips teams with large diff (> 5 seats), logs alert intent', async () => {
    mocks.teamsFindMany.mockResolvedValueOnce([{ id: 't-anomaly', ownerId: 'u1' }]);
    mocks.usersFindFirst.mockResolvedValueOnce({
      subscriptionId: 'sub_1',
      subscriptionStatus: 'active',
    });
    setupSelectCount(20); // 20 members but Stripe says 2 = diff 18
    mocks.stripeRetrieve.mockResolvedValueOnce({
      items: { data: [{ id: 'si_1', quantity: 2 }] },
    });

    const report = await reconcileStripeSeats({ dryRun: false });

    expect(report.skippedLargeDiff).toBe(1);
    expect(report.adjusted).toBe(0);
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
  });

  it('halts when aggregate diff exceeds 5% of population (≥ 20 teams)', async () => {
    // 25 teams, 5 with small diff = 20% — should halt (well past 5% threshold)
    const N = 25;
    const teamRows = Array.from({ length: N }, (_, i) => ({
      id: `t${i}`,
      ownerId: `u${i}`,
    }));
    mocks.teamsFindMany.mockResolvedValueOnce(teamRows);

    for (let i = 0; i < N; i++) {
      mocks.usersFindFirst.mockResolvedValueOnce({
        subscriptionId: `sub_${i}`,
        subscriptionStatus: 'active',
      });
      setupSelectCount(i < 20 ? 2 : 3); // first 20 sync, last 5 diff = 20%
      mocks.stripeRetrieve.mockResolvedValueOnce({
        items: { data: [{ id: `si_${i}`, quantity: 2 }] },
      });
    }

    const report = await reconcileStripeSeats({ dryRun: false });

    expect(report.haltedByAggregateLimit).toBe(true);
    expect(report.adjusted).toBe(0);
    expect(mocks.stripeUpdate).not.toHaveBeenCalled();
  });

  it('does NOT trigger aggregate halt for small populations (< 20 teams)', async () => {
    // 5 teams, 1 with diff = 20% but population too small to trigger halt
    const teamRows = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, ownerId: `u${i}` }));
    mocks.teamsFindMany.mockResolvedValueOnce(teamRows);
    for (let i = 0; i < 5; i++) {
      mocks.usersFindFirst.mockResolvedValueOnce({
        subscriptionId: `sub_${i}`,
        subscriptionStatus: 'active',
      });
      setupSelectCount(i < 4 ? 2 : 3);
      mocks.stripeRetrieve.mockResolvedValueOnce({
        items: { data: [{ id: `si_${i}`, quantity: 2 }] },
      });
    }
    mocks.stripeUpdate.mockResolvedValue({});

    const report = await reconcileStripeSeats({ dryRun: false });

    expect(report.haltedByAggregateLimit).toBe(false);
    expect(report.adjusted).toBe(1);
  });

  it('continues processing after individual team errors', async () => {
    mocks.teamsFindMany.mockResolvedValueOnce([
      { id: 't1', ownerId: 'u1' },
      { id: 't2', ownerId: 'u2' },
    ]);
    // t1 → throws on Stripe.retrieve
    mocks.usersFindFirst.mockResolvedValueOnce({
      subscriptionId: 'sub_1',
      subscriptionStatus: 'active',
    });
    setupSelectCount(2);
    mocks.stripeRetrieve.mockRejectedValueOnce(new Error('stripe api down'));

    // t2 → in sync
    mocks.usersFindFirst.mockResolvedValueOnce({
      subscriptionId: 'sub_2',
      subscriptionStatus: 'active',
    });
    setupSelectCount(2);
    mocks.stripeRetrieve.mockResolvedValueOnce({
      items: { data: [{ id: 'si_2', quantity: 2 }] },
    });

    const report = await reconcileStripeSeats({ dryRun: false });

    expect(report.errored).toBe(1);
    expect(report.inSync).toBe(1);
  });
});

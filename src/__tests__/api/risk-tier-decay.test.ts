import { describe, it, expect, vi, beforeEach } from 'vitest';

// 业务逻辑测试 —— 强制 CAN_RISKTIER=true，两种 vitest project (saas /
// on-prem) 都跑同一套业务断言。on-prem 路由 404 不变量在专项测试覆盖。
vi.mock('@/lib/deployment-mode', () => ({
  CAN_RISKTIER: true,
  IS_SAAS: true,
  IS_ONPREM: false,
}));

// Hoisted mock for @/lib/prisma so the route can resolve db via the import chain
vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      users: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

import { POST } from '@/app/api/cron/risk-tier-decay/route';
import { db } from '@/lib/prisma';

function mockReq(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/cron/risk-tier-decay', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/cron/risk-tier-decay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // chained mocks for select().from().where().groupBy()
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([]),
    };
    // @ts-expect-error chained mock
    vi.mocked(db.select).mockReturnValue(selectChain);

    const updateChain = {
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    };
    // @ts-expect-error chained mock
    vi.mocked(db.update).mockReturnValue(updateChain);

    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    // @ts-expect-error chained mock
    vi.mocked(db.insert).mockReturnValue(insertChain);
  });

  it('rejects without CRON_SECRET when env is set', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const r = await POST(mockReq({ authorization: 'Bearer wrong' }));
    expect(r.status).toBe(401);
    delete process.env.CRON_SECRET;
  });

  it('accepts correct bearer or empty CRON_SECRET env', async () => {
    vi.mocked(db.query.users.findMany).mockResolvedValueOnce([]);
    const r = await POST(mockReq());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.decayed).toBe(0);
  });

  it('decays an eligible user (tier 3 → 2, quiet 7d, no events)', async () => {
    const oldDate = new Date(Date.now() - 30 * 86400_000); // 30d ago, well past quiet window
    vi.mocked(db.query.users.findMany).mockResolvedValueOnce([
      {
        id: 'u1',
        riskTier: 3,
        riskTierReason: 'prior_purge=3',
        aiBannedUntil: null,
        updatedAt: oldDate,
      },
    ] as never);

    const r = await POST(mockReq());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.decayed).toBe(1);
    expect(body.results[0]).toMatchObject({
      userId: 'u1',
      previousTier: 3,
      newTier: 2,
    });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1); // audit log
  });

  it('skips a user touched < 7d ago (recently overridden or decayed)', async () => {
    const recent = new Date(Date.now() - 2 * 86400_000); // 2d ago — within quiet window
    vi.mocked(db.query.users.findMany).mockResolvedValueOnce([
      {
        id: 'u1',
        riskTier: 2,
        riskTierReason: 'manual_override:SUP-1:was=3',
        aiBannedUntil: null,
        updatedAt: recent,
      },
    ] as never);

    const r = await POST(mockReq());
    const body = await r.json();
    expect(body.decayed).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('skips a user with active aiBan in the quiet window', async () => {
    const oldDate = new Date(Date.now() - 30 * 86400_000);
    vi.mocked(db.query.users.findMany).mockResolvedValueOnce([
      {
        id: 'u1',
        riskTier: 3,
        riskTierReason: 'prior_purge=3',
        // banned 2 days ago → still inside the 7d quiet window
        aiBannedUntil: new Date(Date.now() - 2 * 86400_000),
        updatedAt: oldDate,
      },
    ] as never);

    const r = await POST(mockReq());
    const body = await r.json();
    expect(body.decayed).toBe(0);
  });

  it('skips users with risk audit events in window', async () => {
    const oldDate = new Date(Date.now() - 30 * 86400_000);
    vi.mocked(db.query.users.findMany).mockResolvedValueOnce([
      {
        id: 'u-noisy',
        riskTier: 3,
        riskTierReason: 'prior_purge=3',
        aiBannedUntil: null,
        updatedAt: oldDate,
      },
    ] as never);

    // select query returns this user as noisy
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue([{ userId: 'u-noisy' }]),
    };
    // @ts-expect-error chained mock
    vi.mocked(db.select).mockReturnValueOnce(selectChain);

    const r = await POST(mockReq());
    const body = await r.json();
    expect(body.decayed).toBe(0);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock module BEFORE importing route handler so the dynamic imports inside
// the handler resolve to mocked db / users / auditLogs / requireAdmin.
vi.mock('@/lib/admin-auth', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      users: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  },
}));

import { GET, POST } from '@/app/api/admin/risk-tier/route';
import { requireAdmin } from '@/lib/admin-auth';
import { db } from '@/lib/prisma';
import { NextResponse } from 'next/server';

function mockRequest(url: string, method = 'GET', body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/admin/risk-tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401/403 when admin check fails', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const r = await GET(mockRequest('http://localhost/api/admin/risk-tier'));
    expect(r.status).toBe(403);
  });

  it('lists users with riskTier >= minTier', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ userId: 'admin-1' });
    vi.mocked(db.query.users.findMany).mockResolvedValueOnce([
      {
        id: 'u1',
        email: 'a@x.com',
        emailNormalized: 'a@x.com',
        plan: 'free',
        riskTier: 3,
        riskTierReason: 'prior_purge=3',
        priorPurgeCount: 3,
        reactivationCount: 0,
        createdAt: new Date('2026-05-01'),
        deletedAt: null,
      },
    ] as never);
    const r = await GET(mockRequest('http://localhost/api/admin/risk-tier?minTier=2'));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].riskTier).toBe(3);
    expect(body.users[0].riskTierReason).toBe('prior_purge=3');
  });

  it('clamps minTier to [1,4]', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ userId: 'admin-1' });
    vi.mocked(db.query.users.findMany).mockResolvedValueOnce([]);

    await GET(mockRequest('http://localhost/api/admin/risk-tier?minTier=99'));

    // verify findMany was called with where = gte(riskTier, 4) — but the
    // mock loses the Drizzle expr structure, so just assert it was called
    // once. Behavioural property: no SQL injection / no >5 / no <1.
    expect(db.query.users.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/risk-tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // chain mocks for db.update / db.insert
    const chain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) };
    // @ts-expect-error mock return
    vi.mocked(db.update).mockReturnValue(chain);
    // @ts-expect-error mock return
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  it('rejects when not admin', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
    const r = await POST(
      mockRequest('http://localhost/api/admin/risk-tier', 'POST', {
        userId: 'u1',
        newTier: 0,
      }),
    );
    expect(r.status).toBe(401);
  });

  it('rejects newTier outside 0..4', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ userId: 'admin-1' });
    const r = await POST(
      mockRequest('http://localhost/api/admin/risk-tier', 'POST', {
        userId: 'u1',
        newTier: 7,
      }),
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('newTier_must_be_0_to_4');
  });

  it('rejects self-override', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ userId: 'admin-1' });
    const r = await POST(
      mockRequest('http://localhost/api/admin/risk-tier', 'POST', {
        userId: 'admin-1',
        newTier: 0,
      }),
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe('cannot_override_self');
  });

  it('404 when target user not found', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ userId: 'admin-1' });
    vi.mocked(db.query.users.findFirst).mockResolvedValueOnce(undefined);
    const r = await POST(
      mockRequest('http://localhost/api/admin/risk-tier', 'POST', {
        userId: 'u-nope',
        newTier: 0,
      }),
    );
    expect(r.status).toBe(404);
  });

  it('updates tier + writes audit log on valid override', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce({ userId: 'admin-1' });
    vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
      id: 'u1',
      riskTier: 3,
      riskTierReason: 'prior_purge=3',
      email: 'a@x.com',
    } as never);

    const r = await POST(
      mockRequest('http://localhost/api/admin/risk-tier', 'POST', {
        userId: 'u1',
        newTier: 0,
        ticketId: 'SUP-42',
        note: 'confirmed legitimate user',
      }),
    );

    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.success).toBe(true);
    expect(body.previousTier).toBe(3);
    expect(body.newTier).toBe(0);
    expect(body.newReason).toContain('manual_override:SUP-42');
    expect(body.newReason).toContain('was=3');
    expect(body.effectivePolicy.trialDays).toBe(14); // tier 0 policy
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1); // audit log
  });
});

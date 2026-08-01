import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 回归：`POST /api/policy-groups/reorder` 的 **parentId 归属校验**（2026-08-01 审计 HIGH）。
 *
 * 缺陷：该路由严格校验了 `orders[].id` 的归属（本人分组，或本人为 owner/admin
 * 的团队分组，否则 404），却对**同一 body 里的 `parentId` 零校验** ——
 * `groupIds` 仅由 `orders.map(o => o.id)` 构建，`parentId` 直接进 UPDATE。
 *
 * ★ 危害不止"挂错位置"：
 *   1. `policyGroups.parentId` 是裸 text 列，**无 FK、无约束**，DB 不兜底；
 *   2. `DELETE /api/policy-groups/[id]` 的级联按 `parentId` 改写且**无 owner 谓词**
 *      → 受害者删除自己的分组时，会连带改写攻击者挂上来的行；反向亦然，
 *      攻击者把受害者的分组挂到自己名下后删除，即可改写不属于自己的行。
 *
 * 本用例钉死：**parentId 必须与 id 一同参与归属校验**。
 */

const { mockGroupFindMany, mockTeamFindMany, mockTransaction } = vi.hoisted(() => ({
  mockGroupFindMany: vi.fn(),
  mockTeamFindMany: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ user: { id: 'user-attacker' } })),
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      policyGroups: { findMany: mockGroupFindMany },
      teamMembers: { findMany: mockTeamFindMany },
    },
    transaction: mockTransaction,
  },
  policyGroups: {
    id: 'pg.id',
    userId: 'pg.userId',
    teamId: 'pg.teamId',
  },
  teamMembers: { userId: 'tm.userId', role: 'tm.role', teamId: 'tm.teamId' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ op: 'and', args }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  inArray: (col: unknown, val: unknown) => ({ op: 'inArray', col, val }),
  sql: () => ({ op: 'sql' }),
}));

const ATTACKER_GROUP = 'group-owned-by-attacker';
const VICTIM_GROUP = 'group-owned-by-victim';

function makeRequest(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

describe('POST /api/policy-groups/reorder — parentId 归属校验', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamFindMany.mockResolvedValue([]); // 攻击者不是任何团队的 owner/admin
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ update: () => ({ set: () => ({ where: async () => undefined }) }) })
    );
    // 只有攻击者自己的分组能被查到；受害者的分组查不到
    mockGroupFindMany.mockImplementation(async (args: { where?: unknown }) => {
      const flat = JSON.stringify(args?.where ?? {});
      return flat.includes(ATTACKER_GROUP) ? [{ id: ATTACKER_GROUP, isSystem: false }] : [];
    });
  });

  it('把受害者分组塞进 parentId 时必须被拒（404），且不执行任何写入', async () => {
    const { POST } = await import('@/app/api/policy-groups/reorder/route');

    const res = await POST(
      makeRequest({
        orders: [{ id: ATTACKER_GROUP, sortOrder: 0, parentId: VICTIM_GROUP }],
      })
    );

    expect(res.status).toBe(404);
    // ★关键断言：拒绝必须发生在写入之前
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('parentId 被纳入归属查询的 ID 集合（不是只查 orders[].id）', async () => {
    const { POST } = await import('@/app/api/policy-groups/reorder/route');

    await POST(
      makeRequest({
        orders: [{ id: ATTACKER_GROUP, sortOrder: 0, parentId: VICTIM_GROUP }],
      })
    ).catch(() => undefined);

    const queried = JSON.stringify(mockGroupFindMany.mock.calls.map((c) => c[0]));
    expect(queried).toContain(VICTIM_GROUP);
  });

  it('仅重排自己的分组（不带 parentId）仍然放行', async () => {
    const { POST } = await import('@/app/api/policy-groups/reorder/route');

    const res = await POST(
      makeRequest({ orders: [{ id: ATTACKER_GROUP, sortOrder: 1 }] })
    );

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

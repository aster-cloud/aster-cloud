import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so variables can be referenced in vi.mock factories
const {
  mockReturningInsert,
  mockValuesInsert,
  mockInsert,
  mockReturningUpdate,
  mockWhereUpdate,
  mockSetUpdate,
  mockUpdate,
  mockWhereDelete,
  mockDelete,
  mockSelect,
  mockTransactionFn,
} = vi.hoisted(() => {
  const mockReturningInsert = vi.fn();
  const mockValuesInsert = vi.fn().mockReturnValue({ returning: mockReturningInsert });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValuesInsert });

  const mockReturningUpdate = vi.fn();
  const mockWhereUpdate = vi.fn().mockReturnValue({ returning: mockReturningUpdate });
  const mockSetUpdate = vi.fn().mockReturnValue({ where: mockWhereUpdate });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSetUpdate });

  const mockWhereDelete = vi.fn().mockResolvedValue(undefined);
  const mockDelete = vi.fn().mockReturnValue({ where: mockWhereDelete });

  const mockSelect = vi.fn();
  const mockTransactionFn = vi.fn();

  return {
    mockReturningInsert,
    mockValuesInsert,
    mockInsert,
    mockReturningUpdate,
    mockWhereUpdate,
    mockSetUpdate,
    mockUpdate,
    mockWhereDelete,
    mockDelete,
    mockSelect,
    mockTransactionFn,
  };
});

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      policyGroups: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      teamMembers: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      policies: {
        findMany: vi.fn(),
      },
    },
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    select: mockSelect,
    transaction: mockTransactionFn,
  },
  policyGroups: { id: {}, userId: {}, parentId: {}, teamId: {}, sortOrder: {}, name: {}, isSystem: {} },
  teamMembers: { userId: {}, teamId: {}, role: {} },
  policies: { id: {}, groupId: {}, deletedAt: {}, userId: {} },
}));

import { GET, POST } from '@/app/api/policy-groups/route';
import { GET as GET_ID, PUT, DELETE } from '@/app/api/policy-groups/[id]/route';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/prisma';

const mockGetSession = vi.mocked(getSession);

const DEFAULT_SESSION = { user: { id: 'user-1' } } as Awaited<ReturnType<typeof getSession>>;

function makeRequest(url: string, method = 'GET', body?: Record<string, unknown>): Request {
  return new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  });
}

// Helper to setup a count select chain returning a given count
function setupCountSelect(count: number) {
  const where = vi.fn().mockResolvedValue([{ count }]);
  const from = vi.fn().mockReturnValue({ where });
  mockSelect.mockReturnValue({ from });
}

function mockPolicyGroup(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'g1',
    name: 'Test Group',
    description: null,
    icon: null,
    sortOrder: 0,
    parentId: null,
    userId: 'user-1',
    teamId: null,
    isSystem: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// Helper to setup max+count selects (used in POST)
function setupMaxThenCountSelect(maxValue: number, countValue: number) {
  let callIdx = 0;
  mockSelect.mockImplementation(() => {
    callIdx++;
    if (callIdx === 1) {
      const where = vi.fn().mockResolvedValue([{ max: maxValue }]);
      const from = vi.fn().mockReturnValue({ where });
      return { from };
    }
    const where = vi.fn().mockResolvedValue([{ count: countValue }]);
    const from = vi.fn().mockReturnValue({ where });
    return { from };
  });
}

describe('Policy Groups API - Drizzle Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(DEFAULT_SESSION);
    // Default: no team memberships
    vi.mocked(db.query.teamMembers.findMany).mockResolvedValue([]);
    vi.mocked(db.query.teamMembers.findFirst).mockResolvedValue(undefined);
    // Default policy count = 0 for all groups
    setupCountSelect(0);
  });

  describe('GET /api/policy-groups', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return groups tree and flat list', async () => {
      const mockGroups = [
        mockPolicyGroup({ id: 'g1', name: 'Root Group' }),
        mockPolicyGroup({ id: 'g2', name: 'Child Group', parentId: 'g1' }),
      ];
      // findMany called for: userGroups, systemGroups
      vi.mocked(db.query.policyGroups.findMany)
        .mockResolvedValueOnce(mockGroups)    // userGroups
        .mockResolvedValueOnce([]);           // systemGroups

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.groups).toBeDefined();
      expect(body.flatGroups).toBeDefined();
    });

    it('should build correct tree structure with children', async () => {
      const mockGroups = [
        mockPolicyGroup({ id: 'g1', name: 'Root' }),
        mockPolicyGroup({ id: 'g2', name: 'Child', parentId: 'g1' }),
      ];
      vi.mocked(db.query.policyGroups.findMany)
        .mockResolvedValueOnce(mockGroups)
        .mockResolvedValueOnce([]);

      const response = await GET();
      const body = await response.json();

      // Root group should have child in tree
      const root = body.groups.find((g: { id: string }) => g.id === 'g1');
      expect(root).toBeDefined();
      expect(root.children).toHaveLength(1);
      expect(root.children[0].id).toBe('g2');
    });

    it('should return 500 on internal error', async () => {
      vi.mocked(db.query.policyGroups.findMany).mockRejectedValue(new Error('DB error'));

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('POST /api/policy-groups', () => {
    const validBody = { name: 'New Group' };

    beforeEach(() => {
      const newGroup = { id: 'g-new', name: 'New Group', parentId: null, userId: 'user-1' };
      mockReturningInsert.mockResolvedValue([newGroup]);
      mockValuesInsert.mockReturnValue({ returning: mockReturningInsert });
      mockInsert.mockReturnValue({ values: mockValuesInsert });
      // max sort order = 0, policy count = 0
      setupMaxThenCountSelect(0, 0);
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await POST(makeRequest('http://localhost/api/policy-groups', 'POST', validBody));
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 400 when name is missing', async () => {
      const response = await POST(makeRequest('http://localhost/api/policy-groups', 'POST', {}));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Name is required');
    });

    it('should return 404 when parentId group is not found', async () => {
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(undefined);
      vi.mocked(db.query.teamMembers.findMany).mockResolvedValue([]);

      const response = await POST(
        makeRequest('http://localhost/api/policy-groups', 'POST', {
          name: 'Child Group',
          parentId: 'nonexistent-parent',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Parent group not found');
    });

    it('should return 403 when teamId specified but user is not a member', async () => {
      vi.mocked(db.query.teamMembers.findFirst).mockResolvedValue(undefined);

      const response = await POST(
        makeRequest('http://localhost/api/policy-groups', 'POST', {
          name: 'Team Group',
          teamId: 'team-1',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Not a team member');
    });

    it('should return 201 on successful group creation', async () => {
      const response = await POST(makeRequest('http://localhost/api/policy-groups', 'POST', validBody));

      expect(response.status).toBe(201);
    });
  });

  describe('GET /api/policy-groups/[id]', () => {
    const mockParams = { params: Promise.resolve({ id: 'g1' }) };

    beforeEach(() => {
      // Multiple count queries
      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        const count = 0;
        const where = vi.fn().mockResolvedValue([{ count }]);
        const from = vi.fn().mockReturnValue({ where });
        return { from };
      });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await GET_ID(makeRequest('http://localhost/api/policy-groups/g1'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when group is not found', async () => {
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(undefined);
      vi.mocked(db.query.teamMembers.findMany).mockResolvedValue([]);

      const response = await GET_ID(makeRequest('http://localhost/api/policy-groups/g1'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Group not found');
    });

    it('should return group with children and policies', async () => {
      const mockGroup = mockPolicyGroup();
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(mockGroup);
      vi.mocked(db.query.policyGroups.findMany).mockResolvedValue([]); // no children
      vi.mocked(db.query.policies.findMany).mockResolvedValue([]); // no policies

      const response = await GET_ID(makeRequest('http://localhost/api/policy-groups/g1'), mockParams);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe('g1');
      expect(body.children).toBeDefined();
      expect(body.policies).toBeDefined();
      expect(body._count).toBeDefined();
    });
  });

  describe('PUT /api/policy-groups/[id]', () => {
    const mockParams = { params: Promise.resolve({ id: 'g1' }) };
    const updateBody = { name: 'Updated Group' };

    beforeEach(() => {
      const existingGroup = mockPolicyGroup({ name: 'Old Name' });
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(existingGroup);
      mockReturningUpdate.mockResolvedValue([{ ...existingGroup, name: 'Updated Group' }]);
      mockWhereUpdate.mockReturnValue({ returning: mockReturningUpdate });
      mockSetUpdate.mockReturnValue({ where: mockWhereUpdate });
      mockUpdate.mockReturnValue({ set: mockSetUpdate });
      setupCountSelect(0);
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await PUT(
        makeRequest('http://localhost/api/policy-groups/g1', 'PUT', updateBody),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when group is not found', async () => {
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(undefined);
      vi.mocked(db.query.teamMembers.findMany).mockResolvedValue([]);

      const response = await PUT(
        makeRequest('http://localhost/api/policy-groups/g1', 'PUT', updateBody),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Group not found');
    });

    it('should return 403 when trying to modify system group', async () => {
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(
        mockPolicyGroup({ name: 'System Group', isSystem: true })
      );

      const response = await PUT(
        makeRequest('http://localhost/api/policy-groups/g1', 'PUT', updateBody),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Cannot modify system group');
    });

    it('should return 400 when group is set as its own parent', async () => {
      const response = await PUT(
        makeRequest('http://localhost/api/policy-groups/g1', 'PUT', { parentId: 'g1' }),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Group cannot be its own parent');
    });

    it('should update group successfully', async () => {
      const response = await PUT(
        makeRequest('http://localhost/api/policy-groups/g1', 'PUT', updateBody),
        mockParams
      );

      expect(response.status).toBe(200);
    });
  });

  describe('DELETE /api/policy-groups/[id]', () => {
    const mockParams = { params: Promise.resolve({ id: 'g1' }) };

    beforeEach(() => {
      const existingGroup = mockPolicyGroup();
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(existingGroup);
      // Policy count and children count both 0
      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        const where = vi.fn().mockResolvedValue([{ count: 0 }]);
        const from = vi.fn().mockReturnValue({ where });
        return { from };
      });
      // transaction
      mockTransactionFn.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
        const txMock = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
          }),
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        };
        await fn(txMock);
      });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      const response = await DELETE(
        makeRequest('http://localhost/api/policy-groups/g1', 'DELETE'),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when group is not found', async () => {
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(undefined);
      vi.mocked(db.query.teamMembers.findMany).mockResolvedValue([]);

      const response = await DELETE(
        makeRequest('http://localhost/api/policy-groups/g1', 'DELETE'),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Group not found');
    });

    it('should return 403 when trying to delete system group', async () => {
      vi.mocked(db.query.policyGroups.findFirst).mockResolvedValue(
        mockPolicyGroup({ name: 'System Group', isSystem: true })
      );

      const response = await DELETE(
        makeRequest('http://localhost/api/policy-groups/g1', 'DELETE'),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Cannot delete system group');
    });

    it('should delete group and return success message', async () => {
      const response = await DELETE(
        makeRequest('http://localhost/api/policy-groups/g1', 'DELETE'),
        mockParams
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.message).toContain('deleted');
    });

    it('should use transaction when deleting group with policies or children', async () => {
      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        const count = selectCallCount === 1 ? 2 : 1; // 2 policies, 1 child
        const where = vi.fn().mockResolvedValue([{ count }]);
        const from = vi.fn().mockReturnValue({ where });
        return { from };
      });

      await DELETE(
        makeRequest('http://localhost/api/policy-groups/g1', 'DELETE'),
        mockParams
      );

      expect(mockTransactionFn).toHaveBeenCalled();
    });
  });
});

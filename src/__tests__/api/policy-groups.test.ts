import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/policy-groups/route';
import {
  GET as GET_BY_ID,
  PUT,
  DELETE,
} from '@/app/api/policy-groups/[id]/route';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    policyGroup: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
      updateMany: vi.fn(),
    },
    teamMember: {
      findFirst: vi.fn(),
    },
    policy: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockGetSession = vi.mocked(getSession);
const mockPrisma = vi.mocked(prisma);

function createPostRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/policy-groups', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createRequestWithId(
  id: string,
  method: string,
  body?: Record<string, unknown>
) {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost/api/policy-groups/${id}`, init);
}

function createParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('Policy Groups API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
    } as Awaited<ReturnType<typeof getSession>>);
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) => (fn as (prisma: typeof mockPrisma) => Promise<unknown>)(mockPrisma));
  });

  describe('GET /api/policy-groups', () => {
    it('should return 401 when user is unauthenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(mockPrisma.policyGroup.findMany).not.toHaveBeenCalled();
    });

    it('should return tree and flat group list for current user', async () => {
      const mockGroups = [
        {
          id: 'root',
          name: 'Root',
          description: 'root node',
          icon: 'folder',
          parentId: null,
          sortOrder: 1,
          userId: 'user-1',
          teamId: null,
          isSystem: false,
          _count: { policies: 2 },
        },
        {
          id: 'child',
          name: 'Child',
          description: 'child node',
          icon: 'child',
          parentId: 'root',
          sortOrder: 2,
          userId: 'user-1',
          teamId: null,
          isSystem: false,
          _count: { policies: 0 },
        },
      ];
      mockPrisma.policyGroup.findMany.mockResolvedValue(mockGroups as never);

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.groups).toHaveLength(1);
      expect(body.groups[0].id).toBe('root');
      expect(body.groups[0].children).toHaveLength(1);
      expect(body.flatGroups).toEqual(mockGroups);
    });

    it('should return 500 when database fails', async () => {
      mockPrisma.policyGroup.findMany.mockRejectedValue(new Error('db error'));

      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  describe('POST /api/policy-groups', () => {
    it('should return 401 when unauthenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const response = await POST(
        createPostRequest({ name: 'New group' })
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should validate name presence', async () => {
      const response = await POST(createPostRequest({ description: 'No name' }));
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Name is required');
    });

    it('should return 404 when parent group is missing', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue(null);

      const response = await POST(
        createPostRequest({ name: 'Child', parentId: 'parent-1' })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Parent group not found');
    });

    it('should return 403 when user is not team member', async () => {
      mockPrisma.teamMember.findFirst.mockResolvedValue(null);

      const response = await POST(
        createPostRequest({ name: 'Team group', teamId: 'team-1' })
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Not a team member');
    });

    it('should create a group with resolved sort order', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValueOnce({ id: 'parent-1' } as never);
      mockPrisma.policyGroup.aggregate.mockResolvedValue({
        _max: { sortOrder: 2 },
      } as never);
      const createdGroup = {
        id: 'group-123',
        name: 'Projects',
        description: 'Group',
        icon: 'star',
        parentId: 'parent-1',
        sortOrder: 3,
        userId: 'user-1',
        _count: { policies: 0 },
      };
      mockPrisma.policyGroup.create.mockResolvedValue(createdGroup as never);

      const response = await POST(
        createPostRequest({
          name: 'Projects',
          description: 'Group',
          icon: 'star',
          parentId: 'parent-1',
        })
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body).toEqual(createdGroup);
      expect(mockPrisma.policyGroup.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ parentId: 'parent-1', userId: 'user-1' }),
        })
      );
      expect(mockPrisma.policyGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Projects',
            parentId: 'parent-1',
            sortOrder: 3,
          }),
        })
      );
    });
  });

  describe('GET /api/policy-groups/[id]', () => {
    it('should return 401 when unauthenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const response = await GET_BY_ID(
        createRequestWithId('group-1', 'GET'),
        createParams('group-1')
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when group does not exist', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue(null);

      const response = await GET_BY_ID(
        createRequestWithId('missing', 'GET'),
        createParams('missing')
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Group not found');
    });

    it('should return group with children and policies', async () => {
      const mockGroup = {
        id: 'group-1',
        name: 'Root',
        isSystem: false,
        parentId: null,
        _count: { policies: 1, children: 1 },
        children: [
          {
            id: 'child',
            name: 'Child',
            parentId: 'group-1',
            sortOrder: 1,
            _count: { policies: 0 },
          },
        ],
        policies: [
          {
            id: 'policy-1',
            name: 'Policy',
            description: 'desc',
            updatedAt: new Date().toISOString(),
          },
        ],
      };
      mockPrisma.policyGroup.findFirst.mockResolvedValue(mockGroup as never);

      const response = await GET_BY_ID(
        createRequestWithId('group-1', 'GET'),
        createParams('group-1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe('group-1');
      expect(body.children).toHaveLength(1);
      expect(body.policies).toHaveLength(1);
    });
  });

  describe('PUT /api/policy-groups/[id]', () => {
    it('should return 401 when unauthenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const response = await PUT(
        createRequestWithId('group-1', 'PUT', { name: 'Updated' }),
        createParams('group-1')
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when group is missing', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue(null);

      const response = await PUT(
        createRequestWithId('missing', 'PUT', { name: 'Updated' }),
        createParams('missing')
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Group not found');
    });

    it('should block updates to system groups', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue({ id: 'g1', isSystem: true } as never);

      const response = await PUT(
        createRequestWithId('g1', 'PUT', { name: 'Updated' }),
        createParams('g1')
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Cannot modify system group');
    });

    it('should prevent assigning self as parent', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue({
        id: 'g1',
        parentId: null,
        isSystem: false,
      } as never);

      const response = await PUT(
        createRequestWithId('g1', 'PUT', { parentId: 'g1' }),
        createParams('g1')
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Group cannot be its own parent');
    });

    it('should detect moving into descendant', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue({
        id: 'g1',
        parentId: null,
        isSystem: false,
      } as never);
      mockPrisma.policyGroup.findMany.mockResolvedValueOnce([{ id: 'child-1' }] as never);

      const response = await PUT(
        createRequestWithId('g1', 'PUT', { parentId: 'child-1' }),
        createParams('g1')
      );
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Cannot move group to its own descendant');
      expect(mockPrisma.policyGroup.update).not.toHaveBeenCalled();
    });

    it('should update group fields', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue({
        id: 'g1',
        parentId: null,
        isSystem: false,
      } as never);
      // Mock findMany for checkIsDescendant (when parentId changes)
      mockPrisma.policyGroup.findMany.mockResolvedValue([] as never);
      const updatedGroup = {
        id: 'g1',
        name: 'Updated',
        description: 'Desc',
        icon: 'folder',
        parentId: 'parent-1',
        sortOrder: 5,
        _count: { policies: 3 },
      };
      mockPrisma.policyGroup.update.mockResolvedValue(updatedGroup as never);

      const response = await PUT(
        createRequestWithId('g1', 'PUT', {
          name: 'Updated',
          description: 'Desc',
          icon: 'folder',
          parentId: 'parent-1',
          sortOrder: 5,
        }),
        createParams('g1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(updatedGroup);
      expect(mockPrisma.policyGroup.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'g1' },
          data: expect.objectContaining({
            name: 'Updated',
            parentId: 'parent-1',
            sortOrder: 5,
          }),
        })
      );
    });
  });

  describe('DELETE /api/policy-groups/[id]', () => {
    it('should return 401 when unauthenticated', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      const response = await DELETE(
        createRequestWithId('g1', 'DELETE'),
        createParams('g1')
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 404 when group missing', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue(null);

      const response = await DELETE(
        createRequestWithId('missing', 'DELETE'),
        createParams('missing')
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Group not found');
    });

    it('should block deleting system group', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue({ id: 'g1', isSystem: true } as never);

      const response = await DELETE(
        createRequestWithId('g1', 'DELETE'),
        createParams('g1')
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Cannot delete system group');
    });

    it('should move policies and children before deleting', async () => {
      mockPrisma.policyGroup.findFirst.mockResolvedValue({
        id: 'g1',
        parentId: 'parent-1',
        isSystem: false,
        _count: { policies: 2, children: 1 },
      } as never);

      const response = await DELETE(
        createRequestWithId('g1', 'DELETE', {
          movePoliciesToParent: false,
          moveChildrenToParent: false,
        }),
        createParams('g1')
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockPrisma.policy.updateMany).toHaveBeenCalledWith({
        where: { groupId: 'g1' },
        data: { groupId: null },
      });
      expect(mockPrisma.policyGroup.updateMany).toHaveBeenCalledWith({
        where: { parentId: 'g1' },
        data: { parentId: null },
      });
      expect(mockPrisma.policyGroup.delete).toHaveBeenCalledWith({
        where: { id: 'g1' },
      });
    });
  });
});

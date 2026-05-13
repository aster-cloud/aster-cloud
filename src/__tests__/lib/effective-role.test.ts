import { describe, it, expect, vi } from 'vitest';
import { canAccess, type EffectiveRole } from '@/lib/effective-role';

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      teamMembers: {
        findMany: vi.fn(),
      },
    },
  },
}));

import { getEffectiveRole } from '@/lib/effective-role';
import { db } from '@/lib/prisma';

describe('canAccess', () => {
  it('viewer is the floor', () => {
    expect(canAccess('viewer', 'viewer')).toBe(true);
    expect(canAccess('viewer', 'member')).toBe(false);
    expect(canAccess('viewer', 'admin')).toBe(false);
    expect(canAccess('viewer', 'owner')).toBe(false);
  });

  it('member sees member+ resources, not admin', () => {
    expect(canAccess('member', 'viewer')).toBe(true);
    expect(canAccess('member', 'member')).toBe(true);
    expect(canAccess('member', 'admin')).toBe(false);
  });

  it('admin sees everything except owner-exclusive', () => {
    expect(canAccess('admin', 'admin')).toBe(true);
    expect(canAccess('admin', 'owner')).toBe(false);
  });

  it('owner sees everything', () => {
    const all: EffectiveRole[] = ['viewer', 'member', 'admin', 'owner'];
    for (const min of all) {
      expect(canAccess('owner', min)).toBe(true);
    }
  });
});

describe('getEffectiveRole', () => {
  it('solo user (no memberships) defaults to owner', async () => {
    vi.mocked(db.query.teamMembers.findMany).mockResolvedValueOnce([] as never);
    expect(await getEffectiveRole('u1')).toBe('owner');
  });

  it('returns highest role across multiple teams', async () => {
    vi.mocked(db.query.teamMembers.findMany).mockResolvedValueOnce([
      { role: 'viewer' },
      { role: 'admin' },
      { role: 'member' },
    ] as never);
    expect(await getEffectiveRole('u1')).toBe('admin');
  });

  it('viewer-only user stays viewer', async () => {
    vi.mocked(db.query.teamMembers.findMany).mockResolvedValueOnce([
      { role: 'viewer' },
    ] as never);
    expect(await getEffectiveRole('u1')).toBe('viewer');
  });
});

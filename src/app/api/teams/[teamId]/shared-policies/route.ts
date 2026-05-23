/*
 * GET /api/teams/[teamId]/shared-policies
 *
 * Lists policies shared *with this team* (not policies the team
 * owns). Powers the "Shared with this team" section on
 * /teams/[id]/policies. The caller must be a member of the team.
 *
 * Gated 404 when sharing is disabled.
 */

import { NextResponse } from 'next/server';
import { eq, inArray, isNull, and, desc } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import {
  db,
  policies,
  policyShares,
  users,
  type SharePermission,
} from '@/lib/prisma';
import { errorEnvelope } from '@/lib/api/error-envelope';
import { isPolicySharingEnabled } from '@/lib/platform-settings';
import {
  checkTeamPermission,
  TeamPermission,
} from '@/lib/team-permissions';

type RouteParams = { params: Promise<{ teamId: string }> };

export async function GET(req: Request, { params }: RouteParams) {
  try {
    if (!(await isPolicySharingEnabled())) {
      return new NextResponse(null, { status: 404 });
    }
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { teamId } = await params;

    // Permission: any team member can view what's shared with the
    // team. Owners / admins see the same list as members.
    const perm = await checkTeamPermission(
      session.user.id,
      teamId,
      TeamPermission.POLICY_VIEW,
    );
    if (!perm.allowed) {
      return new NextResponse(null, { status: 404 });
    }

    const shareRows = await db.query.policyShares.findMany({
      where: eq(policyShares.teamId, teamId),
      orderBy: [desc(policyShares.createdAt)],
    });
    if (shareRows.length === 0) {
      return NextResponse.json({ shares: [] });
    }

    const policyIds = [...new Set(shareRows.map((s) => s.policyId))];
    const policyRows = await db.query.policies.findMany({
      where: and(inArray(policies.id, policyIds), isNull(policies.deletedAt)),
      columns: {
        id: true,
        name: true,
        description: true,
        userId: true,
        teamId: true,
        updatedAt: true,
      },
    });
    const policyById = new Map(policyRows.map((p) => [p.id, p]));

    const ownerIds = [
      ...new Set(
        policyRows
          .map((p) => p.userId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const ownerRows = ownerIds.length
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, ownerIds))
      : [];
    const ownerById = new Map(ownerRows.map((u) => [u.id, u]));

    const out = shareRows
      .map((s) => {
        const policy = policyById.get(s.policyId);
        if (!policy) return null;
        const owner = policy.userId ? ownerById.get(policy.userId) : null;
        return {
          shareId: s.id,
          policyId: policy.id,
          policyName: policy.name,
          policyDescription: policy.description,
          permission: (s.permission ?? 'execute') as SharePermission,
          ownerName: owner?.name ?? owner?.email ?? null,
          updatedAt: policy.updatedAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return NextResponse.json({ shares: out });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not load shared policies.',
    });
    console.error(
      '[team shared-policies GET] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

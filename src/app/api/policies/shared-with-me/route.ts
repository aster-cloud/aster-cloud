/*
 * GET /api/policies/shared-with-me
 *
 * Lists policies shared with any team the caller belongs to,
 * scoped to the policy_sharing.enabled flag. Returns a flat list
 * with enough metadata to render a "Shared with my teams" section
 * on /policies without a second roundtrip.
 *
 * Gated 404 when sharing is disabled — same posture as the share
 * CRUD endpoints (avoids leaking the flag state).
 */

import { NextResponse } from 'next/server';
import { eq, inArray, isNull, and, desc } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import {
  db,
  policies,
  policyShares,
  teamMembers,
  teams,
  users,
  type SharePermission,
} from '@/lib/prisma';
import { errorEnvelope } from '@/lib/api/error-envelope';
import { isPolicySharingEnabled } from '@/lib/platform-settings';

export async function GET() {
  try {
    if (!(await isPolicySharingEnabled())) {
      return new NextResponse(null, { status: 404 });
    }
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Step 1: caller's team memberships. Empty → empty list.
    const memberships = await db.query.teamMembers.findMany({
      where: eq(teamMembers.userId, session.user.id),
      columns: { teamId: true },
    });
    const myTeamIds = memberships.map((m) => m.teamId);
    if (myTeamIds.length === 0) {
      return NextResponse.json({ shares: [] });
    }

    // Step 2: every share targeting one of those teams. Newest first
    // — when a policy is shared and the user lands on /policies, the
    // freshly-arrived row should sit at the top.
    const shareRows = await db.query.policyShares.findMany({
      where: inArray(policyShares.teamId, myTeamIds),
      orderBy: [desc(policyShares.createdAt)],
    });
    if (shareRows.length === 0) {
      return NextResponse.json({ shares: [] });
    }

    // Step 3: hydrate policy + team + owner display info in three
    // bounded queries (one per type). Beats N+1 fan-out.
    const policyIds = [...new Set(shareRows.map((s) => s.policyId))];
    const teamIds = [...new Set(shareRows.map((s) => s.teamId))];
    const [policyRows, teamRows] = await Promise.all([
      db.query.policies.findMany({
        where: and(inArray(policies.id, policyIds), isNull(policies.deletedAt)),
        columns: {
          id: true,
          name: true,
          description: true,
          userId: true,
          teamId: true,
          updatedAt: true,
        },
      }),
      db
        .select({ id: teams.id, name: teams.name, slug: teams.slug })
        .from(teams)
        .where(inArray(teams.id, teamIds)),
    ]);
    const policyById = new Map(policyRows.map((p) => [p.id, p]));
    const teamById = new Map(teamRows.map((t) => [t.id, t]));

    // Owner display: only fetch the unique owner userIds we need.
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

    // Compose. Drop shares whose policy has been deleted (the JOIN
    // already filtered deletedAt — but a share could outlive an
    // orphaned policyId if hard-delete ever runs).
    const out = shareRows
      .map((s) => {
        const policy = policyById.get(s.policyId);
        if (!policy) return null;
        const team = teamById.get(s.teamId);
        const owner = policy.userId ? ownerById.get(policy.userId) : null;
        return {
          shareId: s.id,
          policyId: policy.id,
          policyName: policy.name,
          policyDescription: policy.description,
          teamId: s.teamId,
          teamName: team?.name ?? s.teamId,
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
      '[shared-with-me GET] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

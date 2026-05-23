/*
 * Policy share management.
 *
 * GET    /api/policies/:id/shares           → list shares (owner-only)
 * POST   /api/policies/:id/shares           → { teamId } create a share
 * DELETE /api/policies/:id/shares?teamId=…  → revoke a share
 *
 * Gating:
 *   1. Platform admin toggle `policy_sharing.enabled` must be ON.
 *      OFF → 404 across the board so the feature looks like it
 *      doesn't exist (avoids leaking the admin toggle state).
 *   2. Caller must be the policy's owner. For user-owned policies
 *      that means policies.userId === caller. For team-owned
 *      policies, caller must have POLICY_CREATE on the owning team
 *      (admin/owner roles).
 *   3. Cannot share a team-owned policy with the same team that
 *      already owns it (would be a no-op grant).
 *
 * Permission bundle on a share is fixed at "view + execute" — the
 * read paths (/api/policies/:id, /api/policies/:id/execute) honour
 * shares as a grant in addition to ownership.
 *
 * Notification: a `policy.shared` notification is dropped onto the
 * target team's owner. We don't fan out to every member to avoid
 * noise — the owner can communicate to their team however they
 * already do.
 */

import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import {
  db,
  policies,
  policyShares,
  teams,
  teamMembers,
  auditLogs,
  SHARE_PERMISSIONS,
  type SharePermission,
} from '@/lib/prisma';
import { errorEnvelope } from '@/lib/api/error-envelope';
import { isPolicySharingEnabled } from '@/lib/platform-settings';
import {
  checkTeamPermission,
  TeamPermission,
} from '@/lib/team-permissions';
import { createNotification } from '@/lib/notifications';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Verify the caller is the owner of this policy (and resolve the
 * owner info). For team-owned policies, owner = anyone with
 * POLICY_CREATE on the owning team. Returns the policy or null.
 */
async function loadOwnedPolicy(
  callerUserId: string,
  policyId: string,
): Promise<
  | {
      policy: typeof policies.$inferSelect;
      kind: 'user' | 'team';
    }
  | null
> {
  const policy = await db.query.policies.findFirst({
    where: eq(policies.id, policyId),
  });
  if (!policy) return null;

  if (policy.teamId) {
    const perm = await checkTeamPermission(
      callerUserId,
      policy.teamId,
      TeamPermission.POLICY_CREATE,
    );
    if (!perm.allowed) return null;
    return { policy, kind: 'team' };
  }
  if (policy.userId === callerUserId) {
    return { policy, kind: 'user' };
  }
  return null;
}

export async function GET(req: Request, { params }: RouteParams) {
  try {
    if (!(await isPolicySharingEnabled())) {
      return new NextResponse(null, { status: 404 });
    }
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const owned = await loadOwnedPolicy(session.user.id, id);
    if (!owned) {
      return new NextResponse(null, { status: 404 });
    }

    const rows = await db.query.policyShares.findMany({
      where: eq(policyShares.policyId, id),
    });

    // Hydrate team names so the UI doesn't need a second roundtrip.
    const teamIds = rows.map((r) => r.teamId);
    const teamRows = teamIds.length
      ? await db
          .select({
            id: teams.id,
            name: teams.name,
            slug: teams.slug,
          })
          .from(teams)
          .where(inArray(teams.id, teamIds))
      : [];
    const teamById = new Map(teamRows.map((t) => [t.id, t]));

    return NextResponse.json({
      shares: rows.map((r) => ({
        id: r.id,
        teamId: r.teamId,
        teamName: teamById.get(r.teamId)?.name ?? r.teamId,
        teamSlug: teamById.get(r.teamId)?.slug ?? '',
        permission: (r.permission ?? 'execute') as SharePermission,
        sharedByUserId: r.sharedByUserId,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not load shares.',
    });
    console.error(
      '[policy-shares GET] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  try {
    if (!(await isPolicySharingEnabled())) {
      return new NextResponse(null, { status: 404 });
    }
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const owned = await loadOwnedPolicy(session.user.id, id);
    if (!owned) {
      return new NextResponse(null, { status: 404 });
    }
    const body = (await req.json()) as {
      teamId?: string;
      permission?: string;
    };
    const { teamId } = body;
    if (!teamId || typeof teamId !== 'string') {
      return NextResponse.json(
        { error: 'teamId is required' },
        { status: 400 },
      );
    }
    // Permission tier: default 'execute' so the API stays
    // backward-compatible with clients that don't send the field.
    // Unknown values 400 (don't silently fall back — caller likely
    // typoed and would be surprised by an unexpected grant level).
    const permission: SharePermission =
      body.permission === undefined
        ? 'execute'
        : (body.permission as SharePermission);
    if (!SHARE_PERMISSIONS.includes(permission)) {
      return NextResponse.json(
        {
          error: `permission must be one of: ${SHARE_PERMISSIONS.join(', ')}`,
        },
        { status: 400 },
      );
    }
    // Can't share a team-owned policy with the same team — the team
    // already owns it.
    if (owned.policy.teamId === teamId) {
      return NextResponse.json(
        { error: 'Cannot share a policy with its owning team' },
        { status: 400 },
      );
    }
    // Target team must exist.
    const targetTeam = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
      columns: { id: true, name: true, ownerId: true },
    });
    if (!targetTeam) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    const shareId = globalThis.crypto.randomUUID();
    let prevPermission: SharePermission | null = null;
    try {
      await db.insert(policyShares).values({
        id: shareId,
        policyId: id,
        teamId,
        permission,
        sharedByUserId: session.user.id,
        createdAt: new Date(),
      });
    } catch (insertErr) {
      // Unique-constraint violation → already shared. Update the
      // existing row's permission so re-sharing with a different
      // tier is the upgrade/downgrade path, not a noop.
      const msg = insertErr instanceof Error ? insertErr.message : String(insertErr);
      if (!msg.includes('PolicyShare_policy_team_key') && !msg.includes('duplicate key')) {
        throw insertErr;
      }
      const existing = await db.query.policyShares.findFirst({
        where: and(
          eq(policyShares.policyId, id),
          eq(policyShares.teamId, teamId),
        ),
      });
      prevPermission = (existing?.permission ?? 'execute') as SharePermission;
      if (existing && existing.permission !== permission) {
        await db
          .update(policyShares)
          .set({ permission })
          .where(
            and(
              eq(policyShares.policyId, id),
              eq(policyShares.teamId, teamId),
            ),
          );
      }
    }

    // Audit log — every share / permission change. Never blocks the
    // response; failures land in the Worker log alongside the
    // request id.
    try {
      await db.insert(auditLogs).values({
        id: globalThis.crypto.randomUUID(),
        userId: session.user.id,
        action:
          prevPermission === null
            ? 'policy.shared'
            : prevPermission === permission
              ? 'policy.share.reaffirmed'
              : 'policy.share.permission_changed',
        resource: 'policy',
        resourceId: id,
        metadata: {
          policyId: id,
          policyName: owned.policy.name,
          teamId,
          teamName: targetTeam.name,
          permission,
          previousPermission: prevPermission,
        },
        createdAt: new Date(),
      });
    } catch (auditErr) {
      console.error(
        '[policy-shares POST] audit write failed (non-fatal)',
        auditErr,
      );
    }

    // Notify the target team owner — only on the *first* share
    // (not on permission changes/reaffirmations) to keep the bell
    // from chattering.
    try {
      if (prevPermission === null && targetTeam.ownerId !== session.user.id) {
        await createNotification({
          userId: targetTeam.ownerId,
          kind: 'policy.shared',
          data: {
            policyId: id,
            policyName: owned.policy.name,
            teamId,
            teamName: targetTeam.name,
            permission,
          },
        });
      }
    } catch (e) {
      console.error('[policy-shares POST] notify failed (non-fatal)', e);
    }

    return NextResponse.json({ ok: true, id: shareId });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not create share.',
    });
    console.error(
      '[policy-shares POST] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    if (!(await isPolicySharingEnabled())) {
      return new NextResponse(null, { status: 404 });
    }
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const owned = await loadOwnedPolicy(session.user.id, id);
    if (!owned) {
      return new NextResponse(null, { status: 404 });
    }
    const url = new URL(req.url);
    const teamId = url.searchParams.get('teamId');
    if (!teamId) {
      return NextResponse.json(
        { error: 'teamId query parameter is required' },
        { status: 400 },
      );
    }
    // Capture the row pre-delete so the audit log can record what
    // was revoked (permission tier, target team) rather than just
    // "share removed".
    const existing = await db.query.policyShares.findFirst({
      where: and(
        eq(policyShares.policyId, id),
        eq(policyShares.teamId, teamId),
      ),
    });
    const targetTeam = existing
      ? await db.query.teams.findFirst({
          where: eq(teams.id, teamId),
          columns: { name: true },
        })
      : null;

    await db
      .delete(policyShares)
      .where(
        and(
          eq(policyShares.policyId, id),
          eq(policyShares.teamId, teamId),
        ),
      );

    if (existing) {
      try {
        await db.insert(auditLogs).values({
          id: globalThis.crypto.randomUUID(),
          userId: session.user.id,
          action: 'policy.share.revoked',
          resource: 'policy',
          resourceId: id,
          metadata: {
            policyId: id,
            policyName: owned.policy.name,
            teamId,
            teamName: targetTeam?.name ?? teamId,
            permission: existing.permission,
          },
          createdAt: new Date(),
        });
      } catch (auditErr) {
        console.error(
          '[policy-shares DELETE] audit write failed (non-fatal)',
          auditErr,
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not remove share.',
    });
    console.error(
      '[policy-shares DELETE] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

// Avoid unused-import warning on teamMembers (used transitively via
// checkTeamPermission). Re-export type to keep the import alive for
// future expansions (e.g. listing members on owner role checks).
export type _TeamMembersAlive = typeof teamMembers;

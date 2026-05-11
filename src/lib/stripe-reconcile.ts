/**
 * Stripe seats reconcile — Phase 3A-3 dunning/webhook safety net.
 *
 * Daily cron compares every active Pro/Enterprise team's member count against
 * the Stripe subscription quantity. Discrepancies indicate a webhook miss
 * (network blip, race condition, etc.) and are auto-corrected.
 *
 * Safety rails (Phase 3 red-line #6):
 *   - DRY_RUN_MODE env var bypasses Stripe updates and only logs intent
 *   - Per-team diff > 5 seats → skip + alert (looks like a logic bug, not a webhook miss)
 *   - Aggregate diff > 5% of population → halt + Slack alert
 */

import { db, teams, teamMembers, users, auditLogs } from '@/lib/prisma';
import { and, eq, sql } from 'drizzle-orm';
import { stripe } from '@/lib/stripe';

const PER_TEAM_DIFF_LIMIT = 5;
const AGGREGATE_DIFF_PERCENT_LIMIT = 5;

export interface ReconcileReport {
  scanned: number;
  inSync: number;
  adjusted: number;
  skippedLargeDiff: number;
  errored: number;
  haltedByAggregateLimit: boolean;
  dryRun: boolean;
  details: Array<{
    teamId: string;
    ownerId: string;
    memberCount: number;
    stripeQuantity: number;
    action: 'in_sync' | 'adjusted' | 'skipped_large_diff' | 'no_subscription' | 'error';
    error?: string;
  }>;
}

export interface ReconcileOptions {
  dryRun?: boolean;
}

export async function reconcileStripeSeats(opts: ReconcileOptions = {}): Promise<ReconcileReport> {
  const dryRun = opts.dryRun ?? process.env.STRIPE_RECONCILE_DRY_RUN === 'true';

  const report: ReconcileReport = {
    scanned: 0,
    inSync: 0,
    adjusted: 0,
    skippedLargeDiff: 0,
    errored: 0,
    haltedByAggregateLimit: false,
    dryRun,
    details: [],
  };

  const allTeams = await db.query.teams.findMany({ columns: { id: true, ownerId: true } });
  report.scanned = allTeams.length;

  // First pass: collect discrepancies without applying. Lets us check aggregate
  // safety threshold before any Stripe writes.
  const candidates: Array<{
    teamId: string;
    ownerId: string;
    memberCount: number;
    stripeQuantity: number;
    subscriptionItemId: string;
    subscriptionId: string;
  }> = [];

  for (const team of allTeams) {
    try {
      const owner = await db.query.users.findFirst({
        where: eq(users.id, team.ownerId),
        columns: { subscriptionId: true, subscriptionStatus: true },
      });

      if (!owner?.subscriptionId || owner.subscriptionStatus !== 'active') {
        report.details.push({
          teamId: team.id,
          ownerId: team.ownerId,
          memberCount: 0,
          stripeQuantity: 0,
          action: 'no_subscription',
        });
        continue;
      }

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id));

      const subscription = await stripe.subscriptions.retrieve(owner.subscriptionId);
      const item = subscription.items.data[0];
      if (!item) {
        report.details.push({
          teamId: team.id,
          ownerId: team.ownerId,
          memberCount: count,
          stripeQuantity: 0,
          action: 'no_subscription',
        });
        continue;
      }

      const stripeQty = item.quantity ?? 0;
      if (stripeQty === count) {
        report.inSync++;
        report.details.push({
          teamId: team.id,
          ownerId: team.ownerId,
          memberCount: count,
          stripeQuantity: stripeQty,
          action: 'in_sync',
        });
        continue;
      }

      if (Math.abs(stripeQty - count) > PER_TEAM_DIFF_LIMIT) {
        report.skippedLargeDiff++;
        report.details.push({
          teamId: team.id,
          ownerId: team.ownerId,
          memberCount: count,
          stripeQuantity: stripeQty,
          action: 'skipped_large_diff',
        });
        continue;
      }

      candidates.push({
        teamId: team.id,
        ownerId: team.ownerId,
        memberCount: count,
        stripeQuantity: stripeQty,
        subscriptionItemId: item.id,
        subscriptionId: owner.subscriptionId,
      });
    } catch (err) {
      report.errored++;
      report.details.push({
        teamId: team.id,
        ownerId: team.ownerId,
        memberCount: 0,
        stripeQuantity: 0,
        action: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Aggregate safety check — only meaningful with non-trivial population.
  // (Below 20 teams the percent metric becomes noise; 1 of 5 = 20% but not actionable.)
  const MIN_TEAMS_FOR_AGGREGATE_CHECK = 20;
  if (allTeams.length >= MIN_TEAMS_FOR_AGGREGATE_CHECK) {
    const diffPercent = (candidates.length / allTeams.length) * 100;
    if (diffPercent > AGGREGATE_DIFF_PERCENT_LIMIT) {
      report.haltedByAggregateLimit = true;
      console.error(
        `[reconcile] HALT: ${candidates.length}/${allTeams.length} (${diffPercent.toFixed(1)}%) ` +
        `teams have discrepancy — exceeds ${AGGREGATE_DIFF_PERCENT_LIMIT}% threshold`,
      );
      return report;
    }
  }

  // Second pass: apply adjustments
  for (const c of candidates) {
    try {
      if (!dryRun) {
        await stripe.subscriptionItems.update(c.subscriptionItemId, {
          quantity: c.memberCount,
          proration_behavior: 'create_prorations',
        });

        await db.insert(auditLogs).values({
          id: globalThis.crypto.randomUUID(),
          userId: c.ownerId,
          action: 'subscription.seats_reconciled',
          resource: 'subscription',
          resourceId: c.subscriptionId,
          metadata: {
            teamId: c.teamId,
            previousQuantity: c.stripeQuantity,
            newQuantity: c.memberCount,
          },
        });
      }
      report.adjusted++;
      report.details.push({
        teamId: c.teamId,
        ownerId: c.ownerId,
        memberCount: c.memberCount,
        stripeQuantity: c.stripeQuantity,
        action: 'adjusted',
      });
    } catch (err) {
      report.errored++;
      report.details.push({
        teamId: c.teamId,
        ownerId: c.ownerId,
        memberCount: c.memberCount,
        stripeQuantity: c.stripeQuantity,
        action: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}

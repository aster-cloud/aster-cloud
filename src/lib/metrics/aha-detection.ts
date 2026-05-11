/**
 * AHA-moment detection: tracks the time from user signup to their first
 * approved policy version.
 *
 * Defined in PM 02 (north-star metric tree) as a leading indicator for WAADR:
 * > "AHA 触达率: 注册 → 首条已发布策略 ≤ 24 小时"
 *
 * Recorded as an audit_logs row with action='aha.first_policy_published',
 * which the WAADR cron in aster-api consumes via Mixpanel sync. We deliberately
 * do NOT call Mixpanel directly from server side here — audit_logs is the
 * canonical event sink for cross-service replay.
 */

import { db, users, policyVersions, auditLogs } from '@/lib/prisma';
import { and, eq, sql } from 'drizzle-orm';

const AHA_WINDOW_HOURS = 24;

export interface AhaDetectionInput {
  userId: string;
  policyVersionId: string;
  approvedAt: Date;
}

/**
 * Detect and record the AHA moment if this approval is the user's first ever
 * published version. Safe to call multiple times — only the first qualifying
 * approval writes the event.
 *
 * Returns true if a new AHA event was recorded, false otherwise.
 */
export async function recordAhaMomentIfFirst(input: AhaDetectionInput): Promise<boolean> {
  const { userId, policyVersionId, approvedAt } = input;

  // Cheapest possible idempotency check: has any AHA event for this user already?
  const existingAha = await db.query.auditLogs.findFirst({
    where: and(
      eq(auditLogs.userId, userId),
      eq(auditLogs.action, 'aha.first_policy_published'),
    ),
    columns: { id: true },
  });
  if (existingAha) return false;

  // Get user signup time
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { createdAt: true },
  });
  if (!user) return false;

  // Count user's approved versions (current one might already be in DB, depends on call order)
  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(policyVersions)
    .where(and(
      eq(policyVersions.createdBy, userId),
      eq(policyVersions.status, 'APPROVED'),
    ));

  // Must be exactly 1 approved version for this user — anything else means they've
  // already had an AHA moment (the audit_logs check above should catch this, but
  // belt-and-suspenders for race conditions).
  if (countRow.c !== 1) return false;

  const hoursToFirst =
    (approvedAt.getTime() - user.createdAt.getTime()) / (1000 * 60 * 60);
  const withinAhaWindow = hoursToFirst <= AHA_WINDOW_HOURS;

  await db.insert(auditLogs).values({
    id: globalThis.crypto.randomUUID(),
    userId,
    action: 'aha.first_policy_published',
    resource: 'policy_version',
    resourceId: policyVersionId,
    metadata: {
      hoursToFirst: Math.round(hoursToFirst * 100) / 100,
      withinAhaWindow,
      ahaWindowHours: AHA_WINDOW_HOURS,
    },
  });

  return true;
}

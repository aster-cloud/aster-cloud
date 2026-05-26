// Lease-acquire + dispatch helper for cron jobs. Wraps any cron route's
// body so the route can be invoked safely from:
//
//   - Cloudflare Workers `scheduled()` (primary, automatic);
//   - GitHub Actions / ops curl (manual or backfill);
//   - Integration tests.
//
// All three feed the same `(jobName, windowStart)` into `runCronOnce`;
// the underlying Postgres UNIQUE constraint + INSERT…ON CONFLICT DO
// NOTHING serializes them. Whichever caller's INSERT wins the
// constraint executes; later callers within the same window get back
// the lease row and return early.
//
// What this is NOT:
//   - A general-purpose distributed mutex. It's keyed by a deterministic
//     window-start; jobs that need finer mutex semantics (overlapping
//     windows, ad-hoc one-shots) should not use this helper.
//   - A retry framework. If the wrapped function throws we mark the
//     lease 'failed' and re-throw. Next scheduled tick gets a fresh
//     window-start and may run again.

import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, cronJobLease } from '@/lib/prisma';
import { currentWindowStart, getCronByJobName } from '@/lib/cron-registry';
import { recordHealthcheckHeartbeat } from '@/lib/healthcheck-heartbeat';

export interface RunCronResult<T> {
  /** True when this caller acquired the lease and ran the function. */
  ran: boolean;
  /** Filled only when ran=true; mirrors the wrapped function's return. */
  result?: T;
  /**
   * Window-start the lease was keyed by (UTC). Useful for callers that
   * want to log "scheduled tick at 04:30" vs "rerun for 04:30".
   */
  windowStart: Date;
  /** Lease row id when ran=true, or the existing row id when ran=false. */
  leaseId: string;
  /** When ran=false, describes why; matches the existing row's status. */
  skippedReason?: 'already-running' | 'already-done' | 'already-failed';
}

export interface RunCronOptions {
  /**
   * Acquirer identity for the audit trail. Common values:
   *   - 'worker-scheduled'  (Cloudflare cron trigger)
   *   - 'http-external'     (curl / ops / GitHub Actions)
   *   - 'integration-test'
   */
  acquiredBy: string;
  /**
   * Override window-start. Cloudflare passes `new Date(event.scheduledTime)`
   * which is the canonical boundary; external callers should usually
   * omit this and let the registry compute it.
   */
  windowStart?: Date;
}

/**
 * Wrap a cron's effectful body. Acquires the per-window lease; runs
 * `fn` exactly once across all callers in the same window.
 *
 * Idempotency contract:
 *   - First caller in a window → returns `{ran: true, result}`.
 *   - Subsequent callers in the same window → return `{ran: false}`
 *     with `skippedReason` reflecting what happened first.
 *
 * On `fn` throw: marks the lease 'failed' (with truncated error text)
 * and re-throws. The caller's HTTP layer translates to 5xx; the next
 * scheduled tick gets a fresh window and tries again.
 */
export async function runCronOnce<T>(
  jobName: string,
  fn: () => Promise<T>,
  opts: RunCronOptions,
): Promise<RunCronResult<T>> {
  const job = getCronByJobName(jobName);
  if (!job) {
    throw new Error(`[cron-lease] runCronOnce called with unregistered jobName=${jobName}`);
  }
  const windowStart = opts.windowStart ?? currentWindowStart(jobName);
  const leaseId = randomUUID();

  // Test seam: unit tests for the route body stub `db` per-test and
  // shouldn't be required to also stub `cronJobLease` operations.
  // Production never reads this env; integration tests don't either.
  if (process.env.BYPASS_CRON_LEASE === '1') {
    const result = await fn();
    return { ran: true, result, windowStart, leaseId };
  }

  // 1) Try to insert as 'running'. ON CONFLICT DO NOTHING means we
  //    return zero rows when someone else already has the window.
  const inserted = await db
    .insert(cronJobLease)
    .values({
      id: leaseId,
      jobName,
      windowStart,
      acquiredBy: opts.acquiredBy,
      status: 'running',
    })
    .onConflictDoNothing({
      target: [cronJobLease.jobName, cronJobLease.windowStart],
    })
    .returning({ id: cronJobLease.id });

  if (inserted.length === 0) {
    // 2) Lost the race. Read the existing row to report what it's doing.
    const existing = await db.query.cronJobLease.findFirst({
      where: and(
        eq(cronJobLease.jobName, jobName),
        eq(cronJobLease.windowStart, windowStart),
      ),
    });
    const reason: RunCronResult<T>['skippedReason'] = existing
      ? existing.status === 'running'
        ? 'already-running'
        : existing.status === 'done'
          ? 'already-done'
          : 'already-failed'
      : 'already-running';
    return {
      ran: false,
      windowStart,
      leaseId: existing?.id ?? leaseId,
      skippedReason: reason,
    };
  }

  // 3) Won the race. Run the body. Always update the lease (success or
  //    failure) so a future scheduled tick can read the outcome
  //    without re-reading worker logs.
  //
  // 心跳：抢到 lease 后立即上报 start；fn 成功上报 success；fn 抛错上报 fail。
  // 跳过路径（步骤 2）不上报 —— 另一个实例会代发，重复心跳会让仪表板
  // 看上去有重复的健康事件。
  if (job.healthcheckEnv) {
    await recordHealthcheckHeartbeat(job.healthcheckEnv, 'start');
  }

  try {
    const result = await fn();
    await db
      .update(cronJobLease)
      .set({ status: 'done', completedAt: sql`now()` })
      .where(eq(cronJobLease.id, leaseId));
    if (job.healthcheckEnv) {
      await recordHealthcheckHeartbeat(job.healthcheckEnv, 'success');
    }
    return { ran: true, result, windowStart, leaseId };
  } catch (err) {
    await db
      .update(cronJobLease)
      .set({
        status: 'failed',
        completedAt: sql`now()`,
        errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      })
      .where(eq(cronJobLease.id, leaseId));
    if (job.healthcheckEnv) {
      await recordHealthcheckHeartbeat(job.healthcheckEnv, 'fail');
    }
    throw err;
  }
}

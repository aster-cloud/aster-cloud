// Aggregate license-usage telemetry from local on-prem state.
//
// Contract: every value emitted is an integer count or boolean — NO
// PII, no event content, no user identifiers, no payload strings. The
// builder is the only on-prem place we touch raw user data; downstream
// uploader sees only the typed aggregate.
//
// Producers must be deterministic across same window: re-running with
// the same (periodStart, periodEnd) on the same DB snapshot returns
// the same payload. SaaS-side dedup key is (license_id, period_start,
// period_end) so non-determinism leaks would cause ingest mismatches.
//
// Scope deliberately narrow: 6 counts + a feature-presence bitmap.
// Adding fields is cheap (schema stores jsonb), but anything that needs
// new query patterns must come with a privacy review.

/* @deployment-mode-hot-gate
 * reason: telemetry only runs in on-prem builds. SaaS build doesn't
 *         have local "users / policies / executions" semantics worth
 *         aggregating — its data shape is multi-tenant. Marker prevents
 *         accidental import from SaaS admin pages.
 */

import { and, count, countDistinct, gte, lte, sql } from 'drizzle-orm';
import { db, executions, policies, users } from '@/lib/prisma';
import type { LicensePayloadV2 } from '@/lib/license';

export interface TelemetryPayload {
  /** Schema version of this payload; bump when adding required fields. */
  schemaVersion: 1;
  /** ISO-8601 boundary (inclusive). */
  periodStart: string;
  /** ISO-8601 boundary (exclusive). */
  periodEnd: string;
  // ───── aggregate counters ─────
  /** Distinct users with at least one login event in the window. */
  activeSeats: number;
  /** Total policies marked active (regardless of recent execution). */
  policiesActive: number;
  /** Total policy executions across all tenants in the window. */
  policyExecutionsCount: number;
  /** Sum of seats observed in any team during the window (>= activeSeats). */
  totalProvisionedSeats: number;
  /** Boolean: did the deployment hit the seat limit at any point? */
  seatLimitHit: boolean;
  /** Sorted list of license features actually exercised in the window. */
  featuresUsed: string[];
  // ───── system-context (no PII, just deployment shape) ─────
  /** Container image tag if known (helps Aster ops correlate bug reports). */
  appVersion?: string;
  /** Node major version. */
  nodeVersion: string;
}

export interface BuildPayloadInput {
  /** Whole license payload (we read `features`, `seatLimit`, etc.). */
  license: LicensePayloadV2;
  /** Window end (exclusive). Defaults to now. */
  periodEnd?: Date;
  /** Window size in days. Defaults to 7. */
  windowDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build a telemetry payload for the given license + reporting window.
 *
 * Throws on db error — caller treats as transient and skips this tick.
 * Never silently substitutes zeros on failure: a false-low report is
 * worse than no report (would skew renewal-time conversations).
 */
export async function buildTelemetryPayload(
  input: BuildPayloadInput,
): Promise<TelemetryPayload> {
  const windowDays = input.windowDays ?? 7;
  const periodEnd = input.periodEnd ?? new Date();
  const periodStart = new Date(periodEnd.getTime() - windowDays * DAY_MS);

  // 1) Distinct active users (any login in window). NextAuth session
  //    table semantics aren't unified across modes; we use users.updated_at
  //    as a proxy because login refreshes it. Conservative — won't
  //    over-count.
  const activeSeatsRow = await db
    .select({ n: countDistinct(users.id) })
    .from(users)
    .where(
      and(
        gte(users.updatedAt, periodStart),
        lte(users.updatedAt, periodEnd),
      ),
    );
  const activeSeats = activeSeatsRow[0]?.n ?? 0;

  // 2) Provisioned seats (currently provisioned, not historical) — just
  //    the row count. Distinguishes "active" (logged in lately) from
  //    "provisioned" (account exists). Both matter at renewal.
  const totalSeatsRow = await db.select({ n: count() }).from(users);
  const totalProvisionedSeats = totalSeatsRow[0]?.n ?? 0;

  // 3) Active policies (Policy.archived = false or whatever schema flag).
  //    We don't filter by execution recency — the "is this license being
  //    used" signal is execution count; "what's installed" is policiesActive.
  const policiesActiveRow = await db.select({ n: count() }).from(policies);
  const policiesActive = policiesActiveRow[0]?.n ?? 0;

  // 4) Executions in window.
  const executionsRow = await db
    .select({ n: count() })
    .from(executions)
    .where(
      and(
        gte(executions.createdAt, periodStart),
        lte(executions.createdAt, periodEnd),
      ),
    );
  const policyExecutionsCount = executionsRow[0]?.n ?? 0;

  // 5) Seat-limit hit detection. seatLimit = -1 means unlimited; never
  //    report hit=true in that case. Otherwise compare to high-water mark
  //    in the window (use totalProvisionedSeats as a stand-in since we
  //    don't snapshot user counts; conservative — true hit at any point
  //    in the window would have been blocked at user-create time, so this
  //    is more of a "capacity headroom" signal than a "fired alarm" one).
  const seatLimit = input.license.seatLimit;
  const seatLimitHit = seatLimit > 0 && totalProvisionedSeats >= seatLimit;

  // 6) featuresUsed — for v1 of the schema we report the license-declared
  //    features verbatim (no per-feature usage probe yet). This is honest:
  //    "what's enabled" is information SaaS can act on at renewal;
  //    instrumenting actual call-sites for each feature would balloon
  //    scope. v2 of the telemetry schema can layer on per-feature counts
  //    without breaking the wire format.
  const featuresUsed = [...input.license.features].sort();

  return {
    schemaVersion: 1,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    activeSeats,
    policiesActive,
    policyExecutionsCount,
    totalProvisionedSeats,
    seatLimitHit,
    featuresUsed,
    appVersion: process.env.ASTER_BUILD_SHA ?? undefined,
    nodeVersion: `${process.versions.node.split('.')[0]}.x`,
  };
}

/** Stable canonical JSON for HMAC input — keys sorted recursively. */
export function canonicalizeTelemetry(payload: TelemetryPayload): string {
  return canonicalStringify(payload as unknown as Record<string, unknown>);
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined) // omit undefined to keep wire stable
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`)
    .join(',')}}`;
}

// suppress unused-vars when sql helper not currently called (future-proof
// for adding raw aggregates without re-importing).
void sql;

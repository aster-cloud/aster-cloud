// TelemetryAccessAudit logger + DSAR/retention deletion helpers.
//
// SOC 2 + GDPR Art 30 (records of processing activities) require:
//   - log every personal-data access by who/when/what
//   - keep delete events for the legal hold period
//   - delete operations must be auditable end-to-end
//
// All read paths in admin/issued-licenses + DSAR endpoints + retention
// cron must call into this module — that's the single point we ensure
// the audit row is written *before* the data is returned/deleted.
//
// Fail-closed: if audit write fails, callers should NOT return data
// (the caller wraps both in a tx where possible).

/* @deployment-mode-hot-gate
 * reason: TelemetryAccessAudit + LicenseTelemetry are SaaS-only tables.
 *         on-prem build has no use for the module; marker keeps shared
 *         admin pages from accidentally importing it.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import {
  db,
  licenseTelemetry,
  telemetryAccessAudit,
} from '@/lib/prisma';

export type AuditAction =
  | 'read-list'
  | 'read-single'
  | 'delete-customer'
  | 'delete-license'
  | 'delete-by-dsar'
  | 'retention-gc';

export type SubjectKind = 'license' | 'customer' | 'row' | 'all-customer';

export interface AuditInput {
  action: AuditAction;
  actorId: string;
  actorEmail?: string;
  subjectKind: SubjectKind;
  subjectKey: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

/** Append one audit row. Fail-closed; caller bails on rejection. */
export async function appendAccessAudit(input: AuditInput): Promise<void> {
  await db.insert(telemetryAccessAudit).values({
    id: randomUUID(),
    action: input.action,
    actorId: input.actorId,
    actorEmail: input.actorEmail ?? null,
    subjectKind: input.subjectKind,
    subjectKey: input.subjectKey,
    metadata: input.metadata ?? null,
    requestId: input.requestId ?? null,
  });
}

// ────────────── Delete operations ──────────────

export interface DeleteResult {
  /** How many LicenseTelemetry rows were physically removed. */
  rowsDeleted: number;
}

/**
 * Delete every telemetry row for a single license. Writes audit row first
 * (so we have a record even if the delete itself errors). Use for DSAR
 * "delete my deployment's telemetry" requests.
 */
export async function deleteTelemetryByLicense(args: {
  licenseId: string;
  actorId: string;
  actorEmail?: string;
  reason: 'dsar' | 'support-request' | 'retention-gc';
  requestId?: string;
  dsarRef?: string;
}): Promise<DeleteResult> {
  const action: AuditAction =
    args.reason === 'dsar'
      ? 'delete-by-dsar'
      : args.reason === 'retention-gc'
        ? 'retention-gc'
        : 'delete-license';
  // Count first so audit has accurate metadata (and so we can detect "no
  // rows to delete" → not an error, but worth logging).
  const existing = await db.query.licenseTelemetry.findMany({
    where: eq(licenseTelemetry.licenseId, args.licenseId),
    columns: { id: true },
  });
  const rowsDeleted = existing.length;

  await appendAccessAudit({
    action,
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    subjectKind: 'license',
    subjectKey: args.licenseId,
    metadata: {
      reason: args.reason,
      rowsDeleted,
      ...(args.dsarRef ? { dsarRef: args.dsarRef } : {}),
    },
    requestId: args.requestId,
  });

  if (rowsDeleted === 0) return { rowsDeleted: 0 };

  await db.delete(licenseTelemetry).where(eq(licenseTelemetry.licenseId, args.licenseId));
  return { rowsDeleted };
}

/** Delete every telemetry row for a customer (all their licenses). */
export async function deleteTelemetryByCustomer(args: {
  customer: string;
  actorId: string;
  actorEmail?: string;
  reason: 'dsar' | 'support-request';
  requestId?: string;
  dsarRef?: string;
}): Promise<DeleteResult> {
  const existing = await db.query.licenseTelemetry.findMany({
    where: eq(licenseTelemetry.customer, args.customer),
    columns: { id: true },
  });
  const rowsDeleted = existing.length;

  await appendAccessAudit({
    action: 'delete-customer',
    actorId: args.actorId,
    actorEmail: args.actorEmail,
    subjectKind: 'customer',
    subjectKey: args.customer,
    metadata: {
      reason: args.reason,
      rowsDeleted,
      ...(args.dsarRef ? { dsarRef: args.dsarRef } : {}),
    },
    requestId: args.requestId,
  });

  if (rowsDeleted === 0) return { rowsDeleted: 0 };
  await db.delete(licenseTelemetry).where(eq(licenseTelemetry.customer, args.customer));
  return { rowsDeleted };
}

// ────────────── Retention GC ──────────────

export interface RetentionConfig {
  /** Max age of LicenseTelemetry rows (default 365d). */
  telemetryMaxAgeDays: number;
  /** Max age of audit READ rows (default 90d). Delete events stay 7y. */
  auditReadMaxAgeDays: number;
  /** Max age of audit DELETE rows (default 7y, legal hold). */
  auditDeleteMaxAgeDays: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  telemetryMaxAgeDays: 365,
  auditReadMaxAgeDays: 90,
  auditDeleteMaxAgeDays: 7 * 365,
};

export interface RetentionResult {
  telemetryDeleted: number;
  auditReadDeleted: number;
  auditDeleteDeleted: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Run retention GC. Idempotent — re-runs delete nothing once cutoff is
 * reached. Self-audits the telemetry purge as `retention-gc` so we have a
 * record of how many rows the GC reaped each tick.
 */
export async function runRetentionGc(args: {
  now?: Date;
  config?: Partial<RetentionConfig>;
  actorId?: string;
}): Promise<RetentionResult> {
  const cfg = { ...DEFAULT_RETENTION, ...args.config };
  const now = args.now ?? new Date();
  const actorId = args.actorId ?? 'system:retention-gc';

  // 1) LicenseTelemetry older than telemetryMaxAgeDays
  const telemetryCutoff = new Date(now.getTime() - cfg.telemetryMaxAgeDays * DAY_MS);
  const oldRows = await db.query.licenseTelemetry.findMany({
    where: lt(licenseTelemetry.receivedAt, telemetryCutoff),
    columns: { id: true },
  });
  const telemetryDeleted = oldRows.length;
  if (telemetryDeleted > 0) {
    await db.delete(licenseTelemetry).where(lt(licenseTelemetry.receivedAt, telemetryCutoff));
    await appendAccessAudit({
      action: 'retention-gc',
      actorId,
      subjectKind: 'all-customer',
      subjectKey: 'telemetry-rows',
      metadata: {
        rowsDeleted: telemetryDeleted,
        cutoff: telemetryCutoff.toISOString(),
      },
    });
  }

  // 2) Old READ audit rows (delete events are retained by separate cutoff)
  const readCutoff = new Date(now.getTime() - cfg.auditReadMaxAgeDays * DAY_MS);
  const oldReads = await db.query.telemetryAccessAudit.findMany({
    where: and(
      lt(telemetryAccessAudit.at, readCutoff),
      // Don't sweep delete rows in this pass — they have a separate (longer)
      // retention. Match on action prefix using OR via two IN checks.
      eq(telemetryAccessAudit.action, 'read-list'),
    ),
    columns: { id: true },
  });
  // Two-pass because drizzle's inArray import isn't in scope; cheaper than
  // adding another import for two values.
  const oldReadSingles = await db.query.telemetryAccessAudit.findMany({
    where: and(
      lt(telemetryAccessAudit.at, readCutoff),
      eq(telemetryAccessAudit.action, 'read-single'),
    ),
    columns: { id: true },
  });
  const auditReadDeleted = oldReads.length + oldReadSingles.length;
  if (auditReadDeleted > 0) {
    await db
      .delete(telemetryAccessAudit)
      .where(
        and(
          lt(telemetryAccessAudit.at, readCutoff),
          eq(telemetryAccessAudit.action, 'read-list'),
        ),
      );
    await db
      .delete(telemetryAccessAudit)
      .where(
        and(
          lt(telemetryAccessAudit.at, readCutoff),
          eq(telemetryAccessAudit.action, 'read-single'),
        ),
      );
  }

  // 3) Old DELETE audit rows (very long retention; rare to reach this).
  const deleteCutoff = new Date(now.getTime() - cfg.auditDeleteMaxAgeDays * DAY_MS);
  const ancientDeletes = await db.query.telemetryAccessAudit.findMany({
    where: lt(telemetryAccessAudit.at, deleteCutoff),
    columns: { id: true },
  });
  const auditDeleteDeleted = ancientDeletes.length;
  if (auditDeleteDeleted > 0) {
    await db
      .delete(telemetryAccessAudit)
      .where(lt(telemetryAccessAudit.at, deleteCutoff));
  }

  return { telemetryDeleted, auditReadDeleted, auditDeleteDeleted };
}

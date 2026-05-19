// Telemetry access-audit + DSAR delete + retention GC integration.
//
// Real postgres. Verifies the SOC 2 / GDPR compliance surface end to end:
//   - appendAccessAudit writes a row
//   - deleteTelemetryByLicense / Customer write the audit FIRST then
//     the delete (so a crash mid-flow still leaves the audit row)
//   - DSAR endpoint requires dsarRef when reason='dsar'
//   - runRetentionGc sweeps LicenseTelemetry past 365d and writes a
//     retention-gc audit row
//
// Tests run under SaaS project (DSAR + retention endpoints are SaaS-only).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  db,
  issuedLicenses,
  licenseTelemetry,
  telemetryAccessAudit,
} from '@/lib/prisma';
import {
  appendAccessAudit,
  deleteTelemetryByCustomer,
  deleteTelemetryByLicense,
  runRetentionGc,
} from '@/lib/telemetry/access-audit';
import {
  cleanupTestDb,
  setupTestDb,
  teardownTestDb,
} from './setup-postgres';

const HEX = 'a'.repeat(64);

async function seedIssuedLicense(licenseId: string, customer = 'Acme'): Promise<void> {
  await db.insert(issuedLicenses).values({
    licenseId,
    customer,
    deploymentBinding: { deploymentId: HEX, deploymentLabel: `${customer}-prod` },
    payloadJson: { schemaVersion: 2 },
    payloadHash: '1'.repeat(64),
    signingKeyId: 'license-signing-v2-2026-01',
    signedAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
    tier: 'enterprise',
    licenseTerm: 'annual',
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    renewedFromLicenseId: null,
    supersededAt: null,
    supersededBy: null,
  });
}

async function seedTelemetry(args: {
  licenseId: string;
  customer?: string;
  receivedAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  const now = args.receivedAt ?? new Date();
  await db.insert(licenseTelemetry).values({
    id,
    licenseId: args.licenseId,
    deploymentId: HEX,
    customer: args.customer ?? 'Acme',
    periodStart: new Date(now.getTime() - 7 * 86_400_000),
    periodEnd: now,
    payload: { schemaVersion: 1, activeSeats: 5 },
    receivedAt: now,
    sourceIp: null,
    signatureKid: 'default',
    signatureAlg: 'HMAC-SHA256',
    signatureB64: 'sig',
  });
  return id;
}

describe.skipIf(process.env.LICENSE_E2E !== '1')('telemetry access audit', () => {
  beforeAll(async () => {
    (process.env as Record<string, string>).NODE_ENV = 'test';
    process.env.DEPLOYMENT_MODE = 'saas';
    await setupTestDb();
  }, 120_000);

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
    await db.delete(telemetryAccessAudit);
    await db.delete(issuedLicenses);
    await db.delete(licenseTelemetry);
  });

  describe('appendAccessAudit', () => {
    it('writes a row with all required fields', async () => {
      await appendAccessAudit({
        action: 'read-list',
        actorId: 'admin_test',
        actorEmail: 'ops@aster.example',
        subjectKind: 'all-customer',
        subjectKey: 'q=Acme',
        metadata: { count: 12 },
        requestId: 'req_abc',
      });
      const rows = await db.query.telemetryAccessAudit.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('read-list');
      expect(rows[0].actorId).toBe('admin_test');
      expect(rows[0].actorEmail).toBe('ops@aster.example');
      expect((rows[0].metadata as { count: number }).count).toBe(12);
      expect(rows[0].requestId).toBe('req_abc');
    });
  });

  describe('deleteTelemetryByLicense', () => {
    it('writes audit row + deletes all matching telemetry rows', async () => {
      const licenseId = `lic_${randomUUID().slice(0, 8)}`;
      await seedIssuedLicense(licenseId);
      await seedTelemetry({ licenseId });
      await seedTelemetry({
        licenseId,
        receivedAt: new Date(Date.now() - 14 * 86_400_000),
      });
      // unrelated row that must NOT be deleted
      const otherLicense = `lic_${randomUUID().slice(0, 8)}`;
      await seedIssuedLicense(otherLicense, 'OtherCustomer');
      await seedTelemetry({ licenseId: otherLicense, customer: 'OtherCustomer' });

      const result = await deleteTelemetryByLicense({
        licenseId,
        actorId: 'admin_dsar',
        reason: 'dsar',
        dsarRef: 'DSAR-2026-0042',
      });
      expect(result.rowsDeleted).toBe(2);

      const remaining = await db.query.licenseTelemetry.findMany();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].licenseId).toBe(otherLicense);

      const audit = await db.query.telemetryAccessAudit.findFirst({
        where: and(
          eq(telemetryAccessAudit.action, 'delete-by-dsar'),
          eq(telemetryAccessAudit.subjectKey, licenseId),
        ),
      });
      expect(audit).toBeTruthy();
      expect((audit?.metadata as { rowsDeleted: number }).rowsDeleted).toBe(2);
      expect((audit?.metadata as { dsarRef: string }).dsarRef).toBe('DSAR-2026-0042');
    });

    it('writes audit row even when no rows match (so DSAR proof exists)', async () => {
      const result = await deleteTelemetryByLicense({
        licenseId: 'lic_nonexistent',
        actorId: 'admin_dsar',
        reason: 'dsar',
        dsarRef: 'DSAR-2026-0043',
      });
      expect(result.rowsDeleted).toBe(0);
      const audit = await db.query.telemetryAccessAudit.findFirst({
        where: eq(telemetryAccessAudit.subjectKey, 'lic_nonexistent'),
      });
      expect(audit).toBeTruthy();
      expect((audit?.metadata as { rowsDeleted: number }).rowsDeleted).toBe(0);
    });
  });

  describe('deleteTelemetryByCustomer', () => {
    it('purges every license belonging to one customer', async () => {
      const customer = 'WillBeDeleted';
      const l1 = `lic_${randomUUID().slice(0, 8)}`;
      const l2 = `lic_${randomUUID().slice(0, 8)}`;
      await seedIssuedLicense(l1, customer);
      await seedIssuedLicense(l2, customer);
      await seedTelemetry({ licenseId: l1, customer });
      await seedTelemetry({ licenseId: l1, customer });
      await seedTelemetry({ licenseId: l2, customer });
      // bystander
      const l3 = `lic_${randomUUID().slice(0, 8)}`;
      await seedIssuedLicense(l3, 'Bystander');
      await seedTelemetry({ licenseId: l3, customer: 'Bystander' });

      const result = await deleteTelemetryByCustomer({
        customer,
        actorId: 'admin',
        reason: 'dsar',
        dsarRef: 'DSAR-cust-1',
      });
      expect(result.rowsDeleted).toBe(3);
      const left = await db.query.licenseTelemetry.findMany();
      expect(left).toHaveLength(1);
      expect(left[0].customer).toBe('Bystander');
    });
  });

  describe('runRetentionGc', () => {
    it('reaps telemetry rows older than the cutoff and audits', async () => {
      const licenseId = `lic_${randomUUID().slice(0, 8)}`;
      await seedIssuedLicense(licenseId);
      // 400d old → should be deleted under default 365d
      await seedTelemetry({
        licenseId,
        receivedAt: new Date(Date.now() - 400 * 86_400_000),
      });
      // 100d old → kept
      await seedTelemetry({
        licenseId,
        receivedAt: new Date(Date.now() - 100 * 86_400_000),
      });
      const result = await runRetentionGc({});
      expect(result.telemetryDeleted).toBe(1);
      const remaining = await db.query.licenseTelemetry.findMany();
      expect(remaining).toHaveLength(1);
      const audit = await db.query.telemetryAccessAudit.findFirst({
        where: eq(telemetryAccessAudit.action, 'retention-gc'),
      });
      expect(audit).toBeTruthy();
      expect((audit?.metadata as { rowsDeleted: number }).rowsDeleted).toBe(1);
    });

    it('is idempotent — second run reaps nothing', async () => {
      const licenseId = `lic_${randomUUID().slice(0, 8)}`;
      await seedIssuedLicense(licenseId);
      await seedTelemetry({
        licenseId,
        receivedAt: new Date(Date.now() - 400 * 86_400_000),
      });
      await runRetentionGc({});
      const second = await runRetentionGc({});
      expect(second.telemetryDeleted).toBe(0);
    });

    it('honors custom telemetryMaxAgeDays for emergency shrink', async () => {
      const licenseId = `lic_${randomUUID().slice(0, 8)}`;
      await seedIssuedLicense(licenseId);
      await seedTelemetry({
        licenseId,
        receivedAt: new Date(Date.now() - 10 * 86_400_000),
      });
      const result = await runRetentionGc({
        config: { telemetryMaxAgeDays: 7 },
      });
      expect(result.telemetryDeleted).toBe(1);
    });

    it('sweeps read audit rows past 90d but keeps delete audit rows', async () => {
      // seed old read + old delete + new read
      await db.insert(telemetryAccessAudit).values({
        id: randomUUID(),
        at: new Date(Date.now() - 100 * 86_400_000),
        action: 'read-list',
        actorId: 'admin',
        subjectKind: 'all-customer',
        subjectKey: 'all',
      });
      await db.insert(telemetryAccessAudit).values({
        id: randomUUID(),
        at: new Date(Date.now() - 100 * 86_400_000),
        action: 'delete-by-dsar',
        actorId: 'admin',
        subjectKind: 'license',
        subjectKey: 'lic_old_purge',
      });
      await db.insert(telemetryAccessAudit).values({
        id: randomUUID(),
        at: new Date(),
        action: 'read-single',
        actorId: 'admin',
        subjectKind: 'license',
        subjectKey: 'lic_recent',
      });
      const result = await runRetentionGc({});
      expect(result.auditReadDeleted).toBe(1);
      expect(result.auditDeleteDeleted).toBe(0); // 7y retention; 100d still well within
      const remaining = await db.query.telemetryAccessAudit.findMany();
      // 1 retained delete audit + 1 recent read = 2
      expect(remaining).toHaveLength(2);
      const actions = remaining.map((r) => r.action).sort();
      expect(actions).toEqual(['delete-by-dsar', 'read-single']);
    });
  });
});

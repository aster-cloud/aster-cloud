// Customer self-service DSAR API (J5) integration.
//
// Auth model is identical to the ingest endpoint (per-license HMAC), so
// these cases focus on the DSAR-specific behavior: access returns rows,
// delete purges, dryRun previews without committing, audit rows land
// with the right action + dsarRef.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  db,
  issuedLicenses,
  licenseTelemetry,
  telemetryAccessAudit,
} from '@/lib/prisma';
import { POST as dsarPOST } from '@/app/api/v1/dsar/route';
import {
  cleanupTestDb,
  setupTestDb,
  teardownTestDb,
} from './setup-postgres';

const HEX = 'a'.repeat(64);
const SECRET = 'topsecret-32-bytes-or-more---0123456789';
const CUSTOMER = 'Acme DSAR';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function seedLicenseWithRows(opts: {
  licenseId: string;
  customer?: string;
  rows: number;
}): Promise<void> {
  const customer = opts.customer ?? CUSTOMER;
  await db.insert(issuedLicenses).values({
    licenseId: opts.licenseId,
    customer,
    deploymentBinding: { deploymentId: HEX, deploymentLabel: `${customer}-prod` },
    payloadJson: {
      schemaVersion: 2,
      licenseId: opts.licenseId,
      customer,
      tier: 'enterprise',
      sku: 'standard',
      features: [],
      seatLimit: 100,
      telemetry: {
        secrets: [{ kid: 'default', secret: SECRET, activatedAt: new Date().toISOString() }],
      },
    },
    payloadHash: '1'.repeat(64),
    signingKeyId: 'license-signing-v2-2026-01',
    signedAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 86_400_000),
    tier: 'enterprise',
    licenseTerm: 'annual',
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    renewedFromLicenseId: null,
    supersededAt: null,
    supersededBy: null,
  });
  for (let i = 0; i < opts.rows; i++) {
    await db.insert(licenseTelemetry).values({
      id: randomUUID(),
      licenseId: opts.licenseId,
      deploymentId: HEX,
      customer,
      periodStart: new Date(Date.now() - (i + 7) * 86_400_000),
      periodEnd: new Date(Date.now() - i * 86_400_000),
      payload: { schemaVersion: 1, activeSeats: i },
      receivedAt: new Date(Date.now() - i * 60_000),
      sourceIp: null,
      signatureKid: 'default',
      signatureAlg: 'HMAC-SHA256',
      signatureB64: 'sig',
      dataRegion: 'us',
    });
  }
}

interface DsarBody {
  action: 'access' | 'delete';
  subject: 'license' | 'customer';
  dryRun?: boolean;
  dsarRef: string;
  nonce: string;
  timestamp: string;
}

async function postDsar(args: {
  licenseId: string;
  body: DsarBody;
  secret?: string;
  customer?: string;
  signatureOverride?: string;
  deploymentId?: string;
}): Promise<{ status: number; body: unknown }> {
  const raw = JSON.stringify(args.body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-aster-license-id': args.licenseId,
    'x-aster-customer': args.customer ?? CUSTOMER,
    'x-aster-signature-kid': 'default',
    'x-aster-signature-alg': 'HMAC-SHA256',
    'x-aster-signature': args.signatureOverride ?? sign(raw, args.secret ?? SECRET),
  };
  if (args.deploymentId !== undefined) headers['x-aster-deployment-id'] = args.deploymentId;
  const req = new Request('http://localhost:3000/api/v1/dsar', {
    method: 'POST',
    headers,
    body: raw,
  });
  const res = await dsarPOST(req);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function defaultBody(over: Partial<DsarBody> = {}): DsarBody {
  return {
    action: 'access',
    subject: 'license',
    dsarRef: 'DSAR-2026-test',
    nonce: randomBytes(16).toString('hex'),
    timestamp: new Date().toISOString(),
    ...over,
  };
}

describe.skipIf(process.env.LICENSE_E2E !== '1')('customer self-service DSAR', () => {
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
    await db.delete(issuedLicenses);
    await db.delete(licenseTelemetry);
    await db.delete(telemetryAccessAudit);
  });

  // ───── auth ─────

  it('rejects request with bad HMAC (same shape as good-license-wrong-key)', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 0 });
    const res = await postDsar({
      licenseId,
      body: defaultBody(),
      signatureOverride: 'AAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('rejected');
  });

  it('rejects unknown license without leaking', async () => {
    const res = await postDsar({ licenseId: 'lic_nonexistent', body: defaultBody() });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('rejected');
  });

  it('rejects customer header mismatch even with valid HMAC', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 0 });
    const res = await postDsar({
      licenseId,
      body: defaultBody(),
      customer: 'SomeoneElse',
    });
    expect(res.status).toBe(400);
    expect((res.body as { reason: string }).reason).toBe('customer-mismatch');
  });

  it('rejects deployment-id mismatch when header supplied', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 0 });
    const res = await postDsar({
      licenseId,
      body: defaultBody(),
      deploymentId: 'b'.repeat(64),
    });
    expect(res.status).toBe(400);
    expect((res.body as { reason: string }).reason).toBe('deployment-id-mismatch');
  });

  it('rejects stale timestamp (> 5 min skew)', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 0 });
    const res = await postDsar({
      licenseId,
      body: defaultBody({
        timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { reason: string }).reason).toBe('stale-timestamp');
  });

  it('rejects missing dsarRef', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 0 });
    const res = await postDsar({
      licenseId,
      body: defaultBody({ dsarRef: '' }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { reason: string }).reason).toBe('dsarRef-required');
  });

  // ───── action=access ─────

  it('access returns the seeded telemetry rows for this license', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 3 });
    const res = await postDsar({
      licenseId,
      body: defaultBody({ action: 'access', subject: 'license' }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { rows: unknown[] }).rows).toHaveLength(3);
    expect((res.body as { retainedFor90DaysAuditOnly: boolean }).retainedFor90DaysAuditOnly).toBe(
      true,
    );
  });

  it('access writes a read-list audit row with dsarRef', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 2 });
    await postDsar({
      licenseId,
      body: defaultBody({ action: 'access', subject: 'license', dsarRef: 'DSAR-AUDIT-A' }),
    });
    const audits = await db.query.telemetryAccessAudit.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('read-list');
    expect(audits[0].actorId).toBe(`customer-dsar:${licenseId}`);
    expect((audits[0].metadata as { dsarRef: string }).dsarRef).toBe('DSAR-AUDIT-A');
  });

  // ───── action=delete ─────

  it('delete (apply) purges this license rows and writes delete-by-dsar audit', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 5 });

    const res = await postDsar({
      licenseId,
      body: defaultBody({
        action: 'delete',
        subject: 'license',
        dryRun: false,
        dsarRef: 'DSAR-DEL-1',
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { rowsDeleted: number }).rowsDeleted).toBe(5);
    expect((res.body as { dryRun: boolean }).dryRun).toBe(false);

    const remaining = await db.query.licenseTelemetry.findMany();
    expect(remaining).toHaveLength(0);
    const audits = await db.query.telemetryAccessAudit.findMany();
    expect(audits.map((a) => a.action)).toContain('delete-by-dsar');
  });

  it('delete (dryRun) preserves rows but writes a dry-run-preview audit', async () => {
    const licenseId = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId, rows: 4 });

    const res = await postDsar({
      licenseId,
      body: defaultBody({
        action: 'delete',
        subject: 'license',
        dryRun: true,
        dsarRef: 'DSAR-DRY-1',
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { rowsDeleted: number }).rowsDeleted).toBe(4);
    expect((res.body as { dryRun: boolean }).dryRun).toBe(true);

    const remaining = await db.query.licenseTelemetry.findMany();
    expect(remaining).toHaveLength(4); // unchanged
    const audits = await db.query.telemetryAccessAudit.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('dry-run-preview');
    expect((audits[0].metadata as { dryRun: boolean }).dryRun).toBe(true);
  });

  it('delete subject=customer purges every license belonging to that customer', async () => {
    const lic1 = `lic_dsar_${randomUUID().slice(0, 8)}`;
    const lic2 = `lic_dsar_${randomUUID().slice(0, 8)}`;
    await seedLicenseWithRows({ licenseId: lic1, rows: 2, customer: CUSTOMER });
    await seedLicenseWithRows({ licenseId: lic2, rows: 3, customer: CUSTOMER });

    const res = await postDsar({
      licenseId: lic1,
      body: defaultBody({
        action: 'delete',
        subject: 'customer',
        dryRun: false,
        dsarRef: 'DSAR-CUST-1',
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { rowsDeleted: number }).rowsDeleted).toBe(5);
    const remaining = await db.query.licenseTelemetry.findMany();
    expect(remaining).toHaveLength(0);
  });
});

// Telemetry ingest endpoint integration. Drives /api/v1/telemetry against
// real postgres (testcontainers) to exercise:
//   - signature verify (real HMAC, real secret stored on IssuedLicense)
//   - deployment-binding cross-check
//   - period validation + persistence
//   - dedupe on (licenseId, periodStart, periodEnd)
//   - 4xx without leaking which licenseId exists
//
// We hit the actual Next.js POST handler via direct invocation so we
// don't need to spin a dev server.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { db, issuedLicenses, licenseTelemetry } from '@/lib/prisma';
import { POST as telemetryPOST } from '@/app/api/v1/telemetry/route';
import {
  canonicalizeTelemetry,
  type TelemetryPayload,
} from '@/lib/telemetry/payload-builder';
import {
  cleanupTestDb,
  setupTestDb,
  teardownTestDb,
} from './setup-postgres';

const HEX = 'a'.repeat(64);
const SECRET = 'topsecret-32-bytes-or-more---0123456789';

function makeSignature(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function seedIssuedLicense(opts: {
  licenseId: string;
  customer?: string;
  deploymentId?: string;
  secrets?: Array<{ kid: string; secret: string; activatedAt: string; retiredAt?: string }>;
}): Promise<void> {
  const customer = opts.customer ?? 'Acme Telemetry';
  const deploymentId = opts.deploymentId ?? HEX;
  const secrets = opts.secrets ?? [
    { kid: 'default', secret: SECRET, activatedAt: new Date().toISOString() },
  ];
  await db.insert(issuedLicenses).values({
    licenseId: opts.licenseId,
    customer,
    deploymentBinding: { deploymentId, deploymentLabel: `${customer}-prod` },
    payloadJson: {
      schemaVersion: 2,
      licenseId: opts.licenseId,
      customer,
      tier: 'enterprise',
      sku: 'standard',
      features: ['ai', 'sso'],
      seatLimit: 100,
      revocationCheckUrl: 'https://license.aster-lang.cloud/revoked.json',
      // telemetry secret store v1 lives on payload_json
      telemetry: { secrets },
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
}

function buildPayload(over: Partial<TelemetryPayload> = {}): TelemetryPayload {
  return {
    schemaVersion: 1,
    periodStart: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    periodEnd: new Date().toISOString(),
    activeSeats: 5,
    policiesActive: 12,
    policyExecutionsCount: 400,
    totalProvisionedSeats: 10,
    seatLimitHit: false,
    featuresUsed: ['ai', 'sso'],
    nodeVersion: '24.x',
    ...over,
  };
}

async function postTelemetry(args: {
  payload: TelemetryPayload;
  licenseId: string;
  deploymentId?: string;
  customer?: string;
  secret?: string;
  secretKid?: string;
  signatureOverride?: string;
}): Promise<{ status: number; body: unknown }> {
  const body = canonicalizeTelemetry(args.payload);
  const sig = args.signatureOverride ?? makeSignature(body, args.secret ?? SECRET);
  const req = new Request('http://localhost:3000/api/v1/telemetry', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-aster-license-id': args.licenseId,
      'x-aster-deployment-id': args.deploymentId ?? HEX,
      'x-aster-customer': args.customer ?? 'Acme Telemetry',
      'x-aster-signature-kid': args.secretKid ?? 'default',
      'x-aster-signature-alg': 'HMAC-SHA256',
      'x-aster-signature': sig,
    },
    body,
  });
  const res = await telemetryPOST(req);
  const respBody = await res.json().catch(() => null);
  return { status: res.status, body: respBody };
}

describe.skipIf(process.env.LICENSE_E2E !== '1')('telemetry ingest', () => {
  beforeAll(async () => {
    (process.env as Record<string, string>).NODE_ENV = 'test';
    // ingest endpoint is SaaS-only — let it through the IS_SAAS guard.
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
  });

  it('happy path: signed payload → 200 + row persisted', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    const res = await postTelemetry({ payload: buildPayload(), licenseId });
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBeTruthy();
    expect((res.body as { deduped: boolean }).deduped).toBe(false);

    const rows = await db.query.licenseTelemetry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].licenseId).toBe(licenseId);
    expect(rows[0].deploymentId).toBe(HEX);
    expect((rows[0].payload as { activeSeats: number }).activeSeats).toBe(5);
  });

  it('replay same window returns deduped=true and no new row', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    const payload = buildPayload();
    const first = await postTelemetry({ payload, licenseId });
    const second = await postTelemetry({ payload, licenseId });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body as { deduped: boolean }).deduped).toBe(true);
    expect((second.body as { id: string }).id).toBe((first.body as { id: string }).id);
    const rows = await db.query.licenseTelemetry.findMany();
    expect(rows).toHaveLength(1);
  });

  it('bad signature → 400 rejected', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    const res = await postTelemetry({
      payload: buildPayload(),
      licenseId,
      signatureOverride: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('rejected');
  });

  it('unknown license → 400 rejected (no leak)', async () => {
    const res = await postTelemetry({ payload: buildPayload(), licenseId: 'lic_nonexistent' });
    expect(res.status).toBe(400);
    // Same generic shape as bad-signature so attacker can't enumerate
    expect((res.body as { error: string }).error).toBe('rejected');
  });

  it('deployment-id mismatch → 400 even with valid HMAC', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId, deploymentId: 'b'.repeat(64) });
    const res = await postTelemetry({ payload: buildPayload(), licenseId, deploymentId: HEX });
    expect(res.status).toBe(400);
  });

  it('customer mismatch → 400 even with valid HMAC', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId, customer: 'RealCustomer' });
    const res = await postTelemetry({
      payload: buildPayload(),
      licenseId,
      customer: 'WrongCustomer',
    });
    expect(res.status).toBe(400);
  });

  it('retired kid → rejected', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({
      licenseId,
      secrets: [
        {
          kid: 'old',
          secret: SECRET,
          activatedAt: '2025-01-01T00:00:00Z',
          retiredAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    const res = await postTelemetry({
      payload: buildPayload(),
      licenseId,
      secretKid: 'old',
    });
    expect(res.status).toBe(400);
  });

  it('inverted period rejected (periodEnd <= periodStart)', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    const now = new Date();
    const res = await postTelemetry({
      payload: buildPayload({
        periodStart: now.toISOString(),
        periodEnd: new Date(now.getTime() - 1).toISOString(),
      }),
      licenseId,
    });
    expect(res.status).toBe(400);
    expect((res.body as { reason: string }).reason).toBe('inverted-period');
  });

  it('period too old rejected (> 365d ago)', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    const res = await postTelemetry({
      payload: buildPayload({
        periodStart: longAgo.toISOString(),
        periodEnd: new Date(longAgo.getTime() + 7 * 86_400_000).toISOString(),
      }),
      licenseId,
    });
    expect(res.status).toBe(400);
    expect((res.body as { reason: string }).reason).toBe('period-too-old');
  });

  it('payload missing required field → 400 malformed', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    // build a manually-corrupted body that signs correctly but fails shape
    const body = JSON.stringify({ schemaVersion: 1, periodStart: 'x' });
    const sig = makeSignature(body, SECRET);
    const req = new Request('http://localhost:3000/api/v1/telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aster-license-id': licenseId,
        'x-aster-deployment-id': HEX,
        'x-aster-customer': 'Acme Telemetry',
        'x-aster-signature-kid': 'default',
        'x-aster-signature-alg': 'HMAC-SHA256',
        'x-aster-signature': sig,
      },
      body,
    });
    const res = await telemetryPOST(req);
    expect(res.status).toBe(400);
  });
});

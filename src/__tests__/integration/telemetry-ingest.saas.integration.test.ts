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
import { createHmac, randomBytes as randomBytesSync, randomUUID } from 'node:crypto';
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

  it('accepts masked customer token (anon-<hex>-<len>) when license customer matches', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId, customer: 'Acme Telemetry' });
    // import in the test scope to avoid name clash with seed helper
    const { maskCustomer } = await import('@/lib/telemetry/uploader');
    const masked = maskCustomer('Acme Telemetry');
    const res = await postTelemetry({
      payload: buildPayload(),
      licenseId,
      customer: masked,
    });
    expect(res.status).toBe(200);
    const rows = await db.query.licenseTelemetry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].customer).toBe(masked);
  });

  it('rejects masked token for a different customer (wrong hash prefix)', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId, customer: 'Acme Telemetry' });
    const { maskCustomer } = await import('@/lib/telemetry/uploader');
    const wrong = maskCustomer('SomeoneElse');
    const res = await postTelemetry({
      payload: buildPayload(),
      licenseId,
      customer: wrong,
    });
    expect(res.status).toBe(400);
  });

  it('stamps data_region from ASTER_DATA_REGION env on accepted row', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    const prev = process.env.ASTER_DATA_REGION;
    process.env.ASTER_DATA_REGION = 'eu';
    try {
      const res = await postTelemetry({ payload: buildPayload(), licenseId });
      expect(res.status).toBe(200);
      expect((res.body as { dataRegion: string }).dataRegion).toBe('eu');
      const rows = await db.query.licenseTelemetry.findMany();
      expect(rows[0].dataRegion).toBe('eu');
    } finally {
      if (prev === undefined) delete process.env.ASTER_DATA_REGION;
      else process.env.ASTER_DATA_REGION = prev;
    }
  });

  it('falls back to "unknown" region when ASTER_DATA_REGION not set', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    const prev = process.env.ASTER_DATA_REGION;
    delete process.env.ASTER_DATA_REGION;
    try {
      const res = await postTelemetry({ payload: buildPayload(), licenseId });
      expect(res.status).toBe(200);
      expect((res.body as { dataRegion: string }).dataRegion).toBe('unknown');
    } finally {
      if (prev !== undefined) process.env.ASTER_DATA_REGION = prev;
    }
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

  // J4: schema-version negotiation. Unknown version is a recognized
  // 4xx with the supported-versions list echoed both in body and
  // header so on-prem cron can stop retrying.
  it('rejects unknown schemaVersion with unsupported-schema-version + header', async () => {
    const licenseId = `lic_ing_${randomUUID().slice(0, 8)}`;
    await seedIssuedLicense({ licenseId });
    const res = await postTelemetry({
      payload: buildPayload({ schemaVersion: 99 as 1 }),
      licenseId,
    });
    expect(res.status).toBe(400);
    expect((res.body as { reason: string }).reason).toBe('unsupported-schema-version');
    expect((res.body as { supportedVersions: number[] }).supportedVersions).toEqual([1]);
  });
});

// J3: envelope-encrypted secrets at rest. Seed an IssuedLicense whose
// telemetry.secrets entry is in the {v, alg, kekKid, iv, ct, tag} shape
// and verify ingest unwraps via the configured KEK.
describe.skipIf(process.env.LICENSE_E2E !== '1')('telemetry ingest: envelope-wrapped secrets (J3)', () => {
  const KEK_HEX = randomBytesSync(32).toString('hex');
  let prevKek: string | undefined;
  let prevKekKid: string | undefined;
  let envelopeMod: typeof import('@/lib/telemetry/envelope');

  beforeAll(async () => {
    (process.env as Record<string, string>).NODE_ENV = 'test';
    process.env.DEPLOYMENT_MODE = 'saas';
    prevKek = process.env.ASTER_TELEMETRY_SECRET_KEK;
    prevKekKid = process.env.ASTER_TELEMETRY_SECRET_KEK_KID;
    process.env.ASTER_TELEMETRY_SECRET_KEK = KEK_HEX;
    process.env.ASTER_TELEMETRY_SECRET_KEK_KID = 'kek-it-A';
    envelopeMod = await import('@/lib/telemetry/envelope');
    envelopeMod.__resetKekCacheForTests();
    await setupTestDb();
  }, 120_000);

  afterAll(async () => {
    if (prevKek === undefined) delete process.env.ASTER_TELEMETRY_SECRET_KEK;
    else process.env.ASTER_TELEMETRY_SECRET_KEK = prevKek;
    if (prevKekKid === undefined) delete process.env.ASTER_TELEMETRY_SECRET_KEK_KID;
    else process.env.ASTER_TELEMETRY_SECRET_KEK_KID = prevKekKid;
    envelopeMod.__resetKekCacheForTests();
    await teardownTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
    await db.delete(issuedLicenses);
    await db.delete(licenseTelemetry);
  });

  async function seedWithWrappedSecret(licenseId: string, plaintext: string): Promise<void> {
    const envelope = envelopeMod.wrapSecret(plaintext);
    const wrappedEntry = {
      kid: 'default',
      activatedAt: new Date().toISOString(),
      ...envelope,
    };
    await db.insert(issuedLicenses).values({
      licenseId,
      customer: 'Acme Telemetry',
      deploymentBinding: { deploymentId: HEX, deploymentLabel: 'Acme-prod' },
      payloadJson: {
        schemaVersion: 2,
        licenseId,
        customer: 'Acme Telemetry',
        tier: 'enterprise',
        sku: 'standard',
        features: [],
        seatLimit: 100,
        revocationCheckUrl: 'https://license.aster-lang.cloud/revoked.json',
        telemetry: { secrets: [wrappedEntry] },
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

  it('unwraps wrapped secret and accepts a valid HMAC upload', async () => {
    const licenseId = `lic_env_${randomUUID().slice(0, 8)}`;
    const plaintext = randomBytesSync(32).toString('base64url');
    await seedWithWrappedSecret(licenseId, plaintext);

    const res = await postTelemetry({ payload: buildPayload(), licenseId, secret: plaintext });
    expect(res.status).toBe(200);
    const rows = await db.query.licenseTelemetry.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].licenseId).toBe(licenseId);
  });

  it('rejects upload signed with wrong key (envelope unwraps to real secret)', async () => {
    const licenseId = `lic_env_${randomUUID().slice(0, 8)}`;
    const plaintext = randomBytesSync(32).toString('base64url');
    await seedWithWrappedSecret(licenseId, plaintext);

    // Sign with a different secret than the one in the envelope.
    const res = await postTelemetry({
      payload: buildPayload(),
      licenseId,
      secret: 'wrong-secret-not-the-envelope-plaintext',
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('rejected');
  });

  it('rejects upload when envelope is tampered (auth tag fails)', async () => {
    const licenseId = `lic_env_${randomUUID().slice(0, 8)}`;
    const plaintext = randomBytesSync(32).toString('base64url');
    // Wrap, then flip one byte of ciphertext.
    const env = envelopeMod.wrapSecret(plaintext);
    const ctBytes = Buffer.from(env.ct, 'base64');
    ctBytes[0] ^= 0xff;
    const tampered = { ...env, ct: ctBytes.toString('base64') };
    const wrappedEntry = {
      kid: 'default',
      activatedAt: new Date().toISOString(),
      ...tampered,
    };
    await db.insert(issuedLicenses).values({
      licenseId,
      customer: 'Acme Telemetry',
      deploymentBinding: { deploymentId: HEX, deploymentLabel: 'Acme-prod' },
      payloadJson: {
        schemaVersion: 2,
        licenseId,
        customer: 'Acme Telemetry',
        tier: 'enterprise',
        sku: 'standard',
        features: [],
        seatLimit: 100,
        revocationCheckUrl: 'https://license.aster-lang.cloud/revoked.json',
        telemetry: { secrets: [wrappedEntry] },
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

    // Even with a syntactically-correct signature, secret-store returns
    // null (decrypt fails) and ingest rejects.
    const res = await postTelemetry({ payload: buildPayload(), licenseId, secret: plaintext });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('rejected');
  });
});

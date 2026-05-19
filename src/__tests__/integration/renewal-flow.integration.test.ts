// Renewal flow integration: token mint → portal verify → checkout consume →
// webhook handler issues new license + supersede pointer.
//
// Scope: SaaS-side data flow against a real postgres (testcontainers).
// We stub the signing-api boundary (license-signing-client) — that
// integration is owned by aster-deploy's vitest project. We do NOT stub
// the renewal-tokens / IssuedLicense / RevokedLicense persistence — those
// are exactly what we want to verify.
//
// Run: LICENSE_E2E=1 pnpm test:integration

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import {
  db,
  issuedLicenses,
  renewalTokens,
  revokedLicenses,
} from '@/lib/prisma';
import {
  mintRenewalToken,
  verifyRenewalToken,
  markTokenConsumed,
  hashRenewalToken,
} from '@/lib/renewal-tokens';
import { handleRenewalCheckoutCompleted } from '@/app/api/stripe/webhook/handlers/renewal-checkout-completed';
import {
  cleanupTestDb,
  setupTestDb,
  teardownTestDb,
} from './setup-postgres';

// ── Stubs for the boundaries we don't want to depend on ──────────────────

vi.mock('@/lib/license-signing-client', () => {
  return {
    signLicensePayload: vi.fn(async (payload: Record<string, unknown>) => {
      // Produce a deterministic fake key so assertions stay stable.
      const payloadStr = JSON.stringify(payload);
      const canonicalPayloadB64url = Buffer.from(payloadStr, 'utf8').toString('base64url');
      const fakeSigB64url = 'AAAAAA'; // not verified by test
      return {
        licenseKey: `aster-ent-v2-license-signing-v2-2026-01-${canonicalPayloadB64url}.${fakeSigB64url}`,
        payloadHash: '0'.repeat(64),
        keyVersion: '1',
        canonicalPayloadB64url,
      };
    }),
  };
});

vi.mock('@/lib/emails/renewal-delivery', () => {
  return {
    sendRenewalSuccessEmail: vi.fn(async () => undefined),
    postRenewalSlackAlert: vi.fn(async () => undefined),
  };
});

// ──────────────────────────────────────────────────────────────────────────

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

function fakeStripeSession(opts: {
  sessionId: string;
  renewalTokenHash: string;
  renewedFromLicenseId: string;
  customerEmail?: string;
}): Stripe.Checkout.Session {
  // Cast — we only populate fields the handler reads, everything else is
  // permissive `unknown` from Stripe's deeply-typed shape.
  return {
    id: opts.sessionId,
    object: 'checkout.session',
    metadata: {
      renewalTokenHash: opts.renewalTokenHash,
      renewedFromLicenseId: opts.renewedFromLicenseId,
    },
    customer_email: opts.customerEmail ?? null,
    customer_details: null,
  } as unknown as Stripe.Checkout.Session;
}

async function insertSeedLicense(opts: {
  licenseId: string;
  customer: string;
  deploymentId: string;
  expiresInDays?: number;
  tier?: string;
  term?: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + (opts.expiresInDays ?? 7) * 86_400_000);
  await db.insert(issuedLicenses).values({
    licenseId: opts.licenseId,
    customer: opts.customer,
    deploymentBinding: {
      deploymentId: opts.deploymentId,
      deploymentLabel: `${opts.customer}-prod`,
    },
    payloadJson: {
      schemaVersion: 2,
      licenseId: opts.licenseId,
      customer: opts.customer,
      tier: opts.tier ?? 'enterprise',
      sku: 'standard',
      features: ['ai', 'sso'],
      seatLimit: 100,
      revocationCheckUrl: 'https://license.aster-lang.cloud/revoked.json',
    },
    payloadHash: '1'.repeat(64),
    signingKeyId: 'license-signing-v2-2026-01',
    signedAt: new Date(Date.now() - 364 * 86_400_000),
    expiresAt,
    tier: opts.tier ?? 'enterprise',
    licenseTerm: opts.term ?? 'annual',
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    renewedFromLicenseId: null,
    supersededAt: null,
    supersededBy: null,
  });
}

describe.skipIf(process.env.LICENSE_E2E !== '1')(
  'renewal flow integration',
  () => {
    beforeAll(async () => {
      (process.env as Record<string, string>).NODE_ENV = 'test';
      process.env.LICENSE_SIGNING_KEY_ID = 'license-signing-v2-2026-01';
      await setupTestDb();
    }, 120_000);

    afterAll(async () => {
      await teardownTestDb();
    });

    beforeEach(async () => {
      await cleanupTestDb();
      // Also wipe the new tables since cleanupTestDb only knows about license-v2 ones.
      await db.delete(issuedLicenses);
      await db.delete(renewalTokens);
      await db.delete(revokedLicenses);
    });

    it('happy path: mint → verify → consume → webhook issues new license', async () => {
      await insertSeedLicense({
        licenseId: 'lic_old_1',
        customer: 'Acme Corp',
        deploymentId: HEX_A,
      });

      // Mint
      const minted = await mintRenewalToken({
        licenseId: 'lic_old_1',
        customer: 'Acme Corp',
        oldDeploymentBinding: { deploymentId: HEX_A, deploymentLabel: 'Acme Corp-prod' },
      });

      // Verify
      const v = await verifyRenewalToken(minted.raw);
      expect(v.kind).toBe('valid');

      // Consume
      const consumed = await markTokenConsumed(minted.raw);
      expect(consumed).not.toBeNull();

      // Webhook
      const session = fakeStripeSession({
        sessionId: 'cs_test_1',
        renewalTokenHash: minted.hash,
        renewedFromLicenseId: 'lic_old_1',
        customerEmail: 'ops@acme.example',
      });
      await handleRenewalCheckoutCompleted(session);

      // Old license has supersededBy set
      const old = await db.query.issuedLicenses.findFirst({
        where: eq(issuedLicenses.licenseId, 'lic_old_1'),
      });
      expect(old?.supersededBy).toMatch(/^lic_/);
      expect(old?.supersededAt).toBeNull(); // overlap-expiry cron sets this later

      // New license exists, points back
      const newLic = await db.query.issuedLicenses.findFirst({
        where: eq(issuedLicenses.stripeCheckoutSessionId, 'cs_test_1'),
      });
      expect(newLic).toBeTruthy();
      expect(newLic?.renewedFromLicenseId).toBe('lic_old_1');
      expect(newLic?.customer).toBe('Acme Corp');
      expect(
        (newLic?.deploymentBinding as { deploymentId?: string })?.deploymentId,
      ).toBe(HEX_A);
      expect(newLic?.tier).toBe('enterprise');
      expect(newLic?.licenseTerm).toBe('annual');
      // Expiry should be ~365d out
      const expiresInDays = Math.round(
        ((newLic?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000,
      );
      expect(expiresInDays).toBeGreaterThanOrEqual(364);
      expect(expiresInDays).toBeLessThanOrEqual(366);
    });

    it('webhook replay (same session) is idempotent', async () => {
      await insertSeedLicense({
        licenseId: 'lic_old_2',
        customer: 'Beta',
        deploymentId: HEX_B,
      });
      const minted = await mintRenewalToken({
        licenseId: 'lic_old_2',
        customer: 'Beta',
        oldDeploymentBinding: { deploymentId: HEX_B, deploymentLabel: 'Beta-prod' },
      });
      await markTokenConsumed(minted.raw);
      const session = fakeStripeSession({
        sessionId: 'cs_test_2',
        renewalTokenHash: minted.hash,
        renewedFromLicenseId: 'lic_old_2',
      });
      await handleRenewalCheckoutCompleted(session);
      await handleRenewalCheckoutCompleted(session);

      // Should be exactly one new license for the session
      const all = await db.query.issuedLicenses.findMany({
        where: eq(issuedLicenses.stripeCheckoutSessionId, 'cs_test_2'),
      });
      expect(all).toHaveLength(1);
    });

    it('verify hashRenewalToken matches storage', async () => {
      const minted = await mintRenewalToken({
        licenseId: 'lic_3',
        customer: 'C',
        oldDeploymentBinding: { deploymentId: HEX_A, deploymentLabel: 'q' },
      });
      expect(hashRenewalToken(minted.raw)).toBe(minted.hash);
    });

    it('webhook with bad metadata is a no-op (returns silently)', async () => {
      const session = fakeStripeSession({
        sessionId: 'cs_bad',
        renewalTokenHash: '',
        renewedFromLicenseId: '',
      });
      await handleRenewalCheckoutCompleted(session);
      const all = await db.query.issuedLicenses.findMany();
      expect(all).toHaveLength(0);
    });

    it('webhook with unknown renewedFromLicenseId is logged but no row created', async () => {
      const session = fakeStripeSession({
        sessionId: 'cs_orphan',
        renewalTokenHash: 'x'.repeat(64),
        renewedFromLicenseId: 'lic_nonexistent',
      });
      await handleRenewalCheckoutCompleted(session);
      const all = await db.query.issuedLicenses.findMany();
      expect(all).toHaveLength(0);
    });
  },
);

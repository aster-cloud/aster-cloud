/**
 * Renewal-flow webhook handler — called from checkout-completed dispatcher
 * when the Stripe session has metadata.renewalTokenHash set.
 *
 * Flow (must be idempotent, webhook may replay):
 *   1. Look up the IssuedLicense row by metadata.renewedFromLicenseId
 *      (Stripe re-delivers the same session.id on retry; we treat the
 *      session_id as the dedupe key — see step 6).
 *   2. Build a fresh v3 license payload: same customer + same
 *      deploymentBinding (binding is non-transferable in self-serve;
 *      cluster moves go through sales), new licenseId, new
 *      issuedAt/expiresAt based on `licenseTerm`.
 *   3. Call license-signing-client to mint the signed key via the
 *      2-person ceremony against aster-deploy/license-signing-api.
 *   4. Insert IssuedLicense row with renewedFromLicenseId pointer and
 *      stripeCheckoutSessionId for dedupe.
 *   5. Email the customer with key + ASTER_DEPLOYMENT_ID reminder.
 *   6. Idempotency: if an IssuedLicense already exists for this
 *      stripeCheckoutSessionId, skip everything — webhook replay,
 *      license already minted, no double charge of work.
 *
 * Failure modes:
 *   - signing-api failure: throw; caller (webhook route) returns 500 so
 *     Stripe retries. Token row stays consumed but no IssuedLicense row,
 *     so the dedupe check correctly re-attempts on next delivery.
 *   - email failure: log + Slack alert; license still inserted (customer
 *     can copy from ops audit page). Don't fail the whole webhook for an
 *     email — Stripe will keep retrying which doesn't help.
 */

import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, issuedLicenses, type IssuedLicense } from '@/lib/prisma';
import { signLicensePayload } from '@/lib/license-signing-client';
import { sendRenewalSuccessEmail, postRenewalSlackAlert } from '@/lib/emails/renewal-delivery';
import { mintTelemetrySecret } from '@/lib/telemetry/issuance';

function termToExpiry(term: string, issuedAt: Date): Date {
  // 与 aster-deploy/scripts/license-issue.sh::utc_add 同语义
  const d = new Date(issuedAt);
  switch (term) {
    case 'annual':
      d.setUTCDate(d.getUTCDate() + 365);
      return d;
    case 'five-year':
      d.setUTCFullYear(d.getUTCFullYear() + 5);
      return d;
    case 'perpetual':
      // 续约不该出现 perpetual（perpetual 是 air-gapped 一次性签发，不走 portal）
      throw new Error('[renewal] perpetual term not eligible for self-serve renewal');
    default:
      throw new Error(`[renewal] unknown licenseTerm: ${term}`);
  }
}

function newLicenseId(): string {
  // 与 license-issue.sh 的 ULID 同形态（lowercase 26-char Crockford base32）。
  // 这里用 crypto 直接生成不同算法的等价标识 — UUID v4 + 去掉破折号。
  // 不必字节兼容 issue.sh，verify 端只校 type=string。
  return `lic_${randomUUID().replace(/-/g, '')}`;
}

export async function handleRenewalCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const sessionId = session.id;
  const tokenHash = session.metadata?.renewalTokenHash;
  const renewedFromLicenseId = session.metadata?.renewedFromLicenseId;

  if (!tokenHash || !renewedFromLicenseId) {
    console.error('[renewal-webhook] missing required metadata', {
      sessionId,
      hasTokenHash: Boolean(tokenHash),
      hasRenewedFrom: Boolean(renewedFromLicenseId),
    });
    return;
  }

  // Step 6 idempotency check — if this session already produced a license,
  // we're seeing a webhook replay. Nothing to do.
  const existing = await db.query.issuedLicenses.findFirst({
    where: eq(issuedLicenses.stripeCheckoutSessionId, sessionId),
  });
  if (existing) {
    console.log('[renewal-webhook] dedupe hit, license already issued', {
      sessionId,
      licenseId: existing.licenseId,
    });
    return;
  }

  // Step 1: load old license
  const oldLicense = await db.query.issuedLicenses.findFirst({
    where: eq(issuedLicenses.licenseId, renewedFromLicenseId),
  });
  if (!oldLicense) {
    // Stripe metadata referenced a license we don't have a record of —
    // shouldn't happen; alert ops, don't throw (no retry would help).
    await postRenewalSlackAlert(
      `[CRITICAL] renewal webhook references unknown license ${renewedFromLicenseId} (session ${sessionId}). Customer paid; ops must resolve.`,
    );
    return;
  }

  // Step 2: build new payload
  const issuedAt = new Date();
  const newId = newLicenseId();
  const payload: Record<string, unknown> = {
    schemaVersion: 2,
    licenseId: newId,
    keyId: process.env.LICENSE_SIGNING_KEY_ID,
    customer: oldLicense.customer,
    issuedAt: issuedAt.toISOString(),
    expiresAt: termToExpiry(oldLicense.licenseTerm, issuedAt).toISOString(),
    seatLimit: extractField(oldLicense.payloadJson, 'seatLimit', 'number'),
    tier: oldLicense.tier,
    features: extractField(oldLicense.payloadJson, 'features', 'array'),
    sku: extractField(oldLicense.payloadJson, 'sku', 'string'),
    licenseTerm: oldLicense.licenseTerm,
    deploymentBinding: oldLicense.deploymentBinding,
    // standard SKU 必填 revocationCheckUrl，复用老 license 的
    revocationCheckUrl: extractField(oldLicense.payloadJson, 'revocationCheckUrl', 'string'),
  };
  // 去掉 undefined 字段（air-gapped 无 revocationCheckUrl）让 canonical 一致
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  // Telemetry inheritance: if the predecessor license had telemetry
  // enabled, mint a fresh wrapped HMAC secret for the renewal. The
  // plaintext is shipped in the email body so the on-prem cron can
  // configure ASTER_TELEMETRY_SECRET; only the envelope persists in
  // payload_json. Inheriting opt-in (rather than re-asking) keeps the
  // self-serve renewal silent for customers who already opted in.
  let telemetryPlaintext: string | undefined;
  const oldTelemetry = oldHasTelemetry(oldLicense.payloadJson);
  if (oldTelemetry) {
    const minted = mintTelemetrySecret({});
    telemetryPlaintext = minted.plaintext;
    payload.telemetry = { secrets: [minted.storedEntry] };
  }

  // Step 3: sign via signing-api
  let signed;
  try {
    signed = await signLicensePayload(payload);
  } catch (err) {
    // Throw to surface as webhook 500 → Stripe retry.
    await postRenewalSlackAlert(
      `[ALERT] signing-api failed for renewal ${newId} (from ${renewedFromLicenseId}, session ${sessionId}): ${err instanceof Error ? err.message : String(err)}. Stripe will retry; if persistent, ops must mint manually.`,
    );
    throw err;
  }

  // Step 4: insert IssuedLicense + link
  const newRow: IssuedLicense = {
    licenseId: newId,
    customer: oldLicense.customer,
    deploymentBinding: oldLicense.deploymentBinding,
    payloadJson: payload,
    payloadHash: signed.payloadHash,
    signingKeyId: process.env.LICENSE_SIGNING_KEY_ID ?? 'unknown',
    signedAt: issuedAt,
    expiresAt: termToExpiry(oldLicense.licenseTerm, issuedAt),
    tier: oldLicense.tier,
    licenseTerm: oldLicense.licenseTerm,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: sessionId,
    renewedFromLicenseId: oldLicense.licenseId,
    supersededAt: null,
    supersededBy: null,
  };
  await db.insert(issuedLicenses).values(newRow);

  // Step 4b: mark old license as superseded-by (overlap window kicks in;
  // cron later sets supersededAt + adds to revocation list).
  await db
    .update(issuedLicenses)
    .set({ supersededBy: newId })
    .where(eq(issuedLicenses.licenseId, oldLicense.licenseId));

  // Step 5: deliver via email + ops audit. Failures here don't roll back
  // — license is signed & persisted; manual recovery path is ops copies
  // from IssuedLicense.payload_json + re-signs (which is idempotent because
  // signing-api would reject as duplicate token).
  const deploymentBinding = oldLicense.deploymentBinding as { deploymentId?: string };
  try {
    await sendRenewalSuccessEmail({
      to:
        deriveEmail(session) ??
        (extractField(oldLicense.payloadJson, 'contactEmail', 'string') as
          | string
          | undefined),
      customer: oldLicense.customer,
      licenseKey: signed.licenseKey,
      deploymentId: deploymentBinding.deploymentId,
      expiresAt: newRow.expiresAt,
      overlapDays: Number.parseInt(process.env.RENEWAL_OVERLAP_DAYS ?? '7', 10),
      telemetrySecret: telemetryPlaintext,
    });
  } catch (err) {
    await postRenewalSlackAlert(
      `[ALERT] email delivery failed for renewal ${newId}: ${err instanceof Error ? err.message : String(err)}. License is signed + in DB; ops can copy from IssuedLicense.`,
    );
  }
  await postRenewalSlackAlert(
    `[renewal] license ${newId} issued (renewed from ${oldLicense.licenseId}, customer ${oldLicense.customer}, expires ${newRow.expiresAt.toISOString()}).`,
  );
}

// ──────────────── helpers ────────────────

type FieldKind = 'string' | 'number' | 'array';
function extractField(json: unknown, field: string, kind: FieldKind): unknown {
  if (!json || typeof json !== 'object') return undefined;
  const v = (json as Record<string, unknown>)[field];
  if (kind === 'string' && typeof v === 'string') return v;
  if (kind === 'number' && typeof v === 'number') return v;
  if (kind === 'array' && Array.isArray(v)) return v;
  return undefined;
}

function oldHasTelemetry(payloadJson: unknown): boolean {
  if (!payloadJson || typeof payloadJson !== 'object') return false;
  const tel = (payloadJson as Record<string, unknown>).telemetry;
  if (!tel || typeof tel !== 'object') return false;
  const secrets = (tel as Record<string, unknown>).secrets;
  return Array.isArray(secrets) && secrets.length > 0;
}

function deriveEmail(session: Stripe.Checkout.Session): string | undefined {
  if (session.customer_email && session.customer_email.includes('@')) return session.customer_email;
  const details = session.customer_details;
  if (details?.email && details.email.includes('@')) return details.email;
  return undefined;
}

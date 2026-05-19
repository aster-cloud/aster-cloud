/**
 * POST /api/renew/[token]/checkout — create a Stripe Checkout session
 * for a one-time renewal payment.
 *
 * Why one-time payment (not subscription):
 *   On-prem renewal is per-term (annual or 5-year), customer reviews
 *   between terms, no auto-renew. Subscription model is reserved for SaaS
 *   billing (different code path, /api/stripe/checkout). On-prem ops need
 *   to know exactly when the money will leave their card — a quiet
 *   auto-renewal would surprise procurement.
 *
 * Token lifecycle:
 *   - Pre-checkout: token must be valid + unconsumed. We consume it on the
 *     create-session call (not after Stripe success) — Stripe success is
 *     the webhook path; if we wait we have a race where ops can double-click
 *     and trigger two checkouts.
 *   - Post-checkout: webhook reads metadata.renewalTokenHash to resolve
 *     back to the token row + old license details. (We don't echo the raw
 *     token to Stripe metadata — only the hash.)
 *
 * SaaS-only. 404 in on-prem.
 */

import { NextResponse } from 'next/server';
import { CAN_BILLING } from '@/lib/deployment-mode';
import { getStripe } from '@/lib/stripe';
import { db, issuedLicenses } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import {
  hashRenewalToken,
  markTokenConsumed,
  verifyRenewalToken,
} from '@/lib/renewal-tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * Look up the price ID for renewing a given license tier + term. Production
 * config lives in env (NEXT_PUBLIC_STRIPE_RENEWAL_* mapping). We keep a
 * tight static allow-list rather than trusting Stripe metadata or a DB
 * lookup — the price is part of the contract with the customer, can't be
 * dynamically substituted by an attacker who controls the request shape.
 */
function resolveRenewalPriceId(
  tier: string,
  licenseTerm: string,
): { priceId: string; description: string } | null {
  const envKey = `STRIPE_RENEWAL_PRICE_${tier.toUpperCase()}_${licenseTerm
    .toUpperCase()
    .replace(/-/g, '_')}`;
  const priceId = process.env[envKey];
  if (!priceId) return null;
  return {
    priceId,
    description: `Aster Enterprise renewal — ${tier} (${licenseTerm})`,
  };
}

export async function POST(_req: Request, ctx: RouteContext) {
  if (!CAN_BILLING) return new NextResponse(null, { status: 404 });

  const { token: rawToken } = await ctx.params;

  // 1. Verify the token (server-side; matches portal page behaviour).
  const outcome = await verifyRenewalToken(rawToken);
  if (outcome.kind !== 'valid') {
    return NextResponse.json(
      { error: `token-${outcome.kind}` },
      { status: 410 }, // Gone — semantically "this link is no longer usable"
    );
  }

  // 2. Find the old license to determine renewal pricing (tier + term).
  const oldLicense = await db.query.issuedLicenses.findFirst({
    where: eq(issuedLicenses.licenseId, outcome.row.licenseId),
  });
  if (!oldLicense) {
    // Should not happen — token mint only runs against rows in IssuedLicense.
    // Treat as data inconsistency, log + reject.
    console.error(
      '[renewal-checkout] token references license missing from IssuedLicense',
      { licenseId: outcome.row.licenseId },
    );
    return NextResponse.json({ error: 'license-not-found' }, { status: 500 });
  }

  const priced = resolveRenewalPriceId(oldLicense.tier, oldLicense.licenseTerm);
  if (!priced) {
    return NextResponse.json(
      { error: 'renewal-not-configured', tier: oldLicense.tier, term: oldLicense.licenseTerm },
      { status: 500 },
    );
  }

  // 3. Consume token *before* creating the Stripe session. If session
  //    creation fails after this we accept the token as burned; ops can
  //    mint a fresh one (cron will detect license still unrenewed).
  const consumed = await markTokenConsumed(rawToken);
  if (!consumed) {
    // Race: two concurrent POSTs from a double-click. Show 'already in
    // progress' rather than create two sessions.
    return NextResponse.json({ error: 'token-already-consumed' }, { status: 409 });
  }

  const tokenHash = hashRenewalToken(rawToken);

  // 4. Create Stripe Checkout session.
  const stripe = await getStripe();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', // one-time, NOT subscription — see header comment
    line_items: [{ price: priced.priceId, quantity: 1 }],
    // Don't ask customer to type their email if we already know it (skips
    // a step + ensures the receipt goes to the same address that got the
    // renewal link).
    customer_email: deriveCustomerEmail(oldLicense.payloadJson),
    success_url: `${appUrl}/renew/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/renew/${encodeURIComponent(rawToken)}`,
    metadata: {
      // 不放 raw token；webhook 用 hash 关联回 RenewalToken。
      renewalTokenHash: tokenHash,
      renewedFromLicenseId: oldLicense.licenseId,
      tier: oldLicense.tier,
      licenseTerm: oldLicense.licenseTerm,
      // 让 ops 通过 Stripe Dashboard 一眼看出归属
      customer: oldLicense.customer,
    },
  });

  if (!session.url) {
    return NextResponse.json({ error: 'stripe-no-session-url' }, { status: 502 });
  }

  return NextResponse.json({ url: session.url });
}

/**
 * Best-effort extract customer email from the v2 payload's optional
 * `contactEmail`. If absent (payload v2 doesn't require it) Stripe will
 * collect it during checkout — that's fine.
 */
function deriveCustomerEmail(payloadJson: unknown): string | undefined {
  if (!payloadJson || typeof payloadJson !== 'object') return undefined;
  const v = (payloadJson as Record<string, unknown>).contactEmail;
  return typeof v === 'string' && v.includes('@') ? v : undefined;
}

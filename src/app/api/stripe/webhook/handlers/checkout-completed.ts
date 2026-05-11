import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users } from '@/lib/prisma';
import { invalidatePlanCache } from '@/lib/plan-gate-client';
import { pushUserSnapshot } from '@/lib/snapshot-pusher';
import type { PlanType } from '@/lib/plans';
import { ensurePersonalTeam, type WebhookHandler } from './_shared';

export const handleCheckoutCompleted: WebhookHandler<Stripe.Checkout.Session> = async (session) => {
  const userId = session.client_reference_id;
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  const metadataPlan = session.metadata?.plan as 'pro' | 'team' | undefined;

  // PM v1.1 grandfather (v3 dead-code path): metadata 中若是 'team' 落库改写为 pro+legacyTier=team
  const isLegacyTeam = metadataPlan === 'team';
  const finalPlan: PlanType = isLegacyTeam ? 'pro' : (metadataPlan || 'pro');

  if (!userId || !customerId || !subscriptionId) return;

  await db
    .update(users)
    .set({
      plan: finalPlan,
      legacyTier: isLegacyTeam ? 'team' : null,
      priceLockedAt: new Date(),
      stripeCustomerId: customerId,
      subscriptionId,
      subscriptionStatus: 'active',
      trialStartedAt: null,
      trialEndsAt: null,
    })
    .where(eq(users.id, userId));

  console.log(
    `User ${userId} upgraded to ${finalPlan}${isLegacyTeam ? ' (grandfathered from team)' : ''}`
  );

  if (finalPlan === 'pro' || finalPlan === 'enterprise') {
    await ensurePersonalTeam(userId);
  }

  await invalidatePlanCache(userId);
  await pushUserSnapshot(userId);
};

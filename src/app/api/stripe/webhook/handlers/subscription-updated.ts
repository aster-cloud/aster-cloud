import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users } from '@/lib/prisma';
import { invalidatePlanCache } from '@/lib/plan-gate-client';
import { pushUserSnapshot } from '@/lib/snapshot-pusher';
import {
  ensurePersonalTeam,
  resolvePlanFromPriceId,
  type SubscriptionStatus,
  type WebhookHandler,
} from './_shared';

export const handleSubscriptionUpdated: WebhookHandler<Stripe.Subscription> = async (subscription) => {
  const customerId = subscription.customer as string;

  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });
  if (!user) return;

  const priceId = subscription.items.data[0]?.price.id;
  const resolved = resolvePlanFromPriceId(priceId);
  if (!resolved) {
    console.warn(`[stripe-webhook] 未识别的 priceId=${priceId}，跳过 plan 更新`);
    return;
  }

  const newPlan = subscription.status === 'active' ? resolved.plan : 'free';

  await db
    .update(users)
    .set({
      plan: newPlan,
      legacyTier: subscription.status === 'active' ? resolved.legacyTier : null,
      subscriptionStatus: subscription.status as SubscriptionStatus,
    })
    .where(eq(users.id, user.id));

  if (newPlan === 'pro' || newPlan === 'enterprise') {
    await ensurePersonalTeam(user.id);
  }

  await invalidatePlanCache(user.id);
  await pushUserSnapshot(user.id);
};

import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users, auditLogs } from '@/lib/prisma';
import { invalidatePlanCache, invalidateApiKeyCache } from '@/lib/plan-gate-client';
import { pushUserSnapshot } from '@/lib/snapshot-pusher';
import type { WebhookHandler } from './_shared';

/**
 * 客户主动取消 / Stripe dunning 重试用尽（默认 4 次失败后）兜底降级。
 */
export const handleSubscriptionDeleted: WebhookHandler<Stripe.Subscription> = async (subscription) => {
  const customerId = subscription.customer as string;

  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });
  if (!user || user.plan === 'free') return;

  await db
    .update(users)
    .set({
      plan: 'free',
      subscriptionId: null,
      subscriptionStatus: 'canceled',
      downgradedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await db.insert(auditLogs).values({
    id: globalThis.crypto.randomUUID(),
    userId: user.id,
    action: 'subscription.cancelled',
    resource: 'subscription',
    resourceId: subscription.id,
  });

  await invalidatePlanCache(user.id);
  await invalidateApiKeyCache(user.id);
  await pushUserSnapshot(user.id);
};

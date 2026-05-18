import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users } from '@/lib/prisma';
import type { SubscriptionStatus, WebhookHandler } from './_shared';

export const handleSubscriptionCreated: WebhookHandler<Stripe.Subscription> = async (subscription) => {
  const customerId = subscription.customer as string;

  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });

  if (!user) return;

  await db
    .update(users)
    .set({
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status as SubscriptionStatus,
    })
    .where(eq(users.id, user.id));
};

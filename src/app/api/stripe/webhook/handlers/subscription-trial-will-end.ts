import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users, auditLogs } from '@/lib/prisma';
import { sendTrialEndingEmailForUser } from '@/lib/email/trial-ending';
import type { WebhookHandler } from './_shared';

export const handleSubscriptionTrialWillEnd: WebhookHandler<Stripe.Subscription> = async (subscription) => {
  const customerId = subscription.customer as string;

  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });
  if (!user) return;

  await db.insert(auditLogs).values({
    id: globalThis.crypto.randomUUID(),
    userId: user.id,
    action: 'subscription.trial_will_end',
    resource: 'subscription',
    resourceId: subscription.id,
  });

  const result = await sendTrialEndingEmailForUser(user.id, 'T-3');
  console.log(`[trial-ending] user=${user.id} stage=T-3 sent=${result.sent} reason=${result.reason}`);
};

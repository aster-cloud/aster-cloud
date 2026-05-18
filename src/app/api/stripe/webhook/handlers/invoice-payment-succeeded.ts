import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users, auditLogs } from '@/lib/prisma';
import { pushUserSnapshot } from '@/lib/snapshot-pusher';
import type { WebhookHandler } from './_shared';

/**
 * 支付恢复 → 清空 dunning 状态（详见 docs/pm/08-dunning.md）。
 */
export const handleInvoicePaymentSucceeded: WebhookHandler<Stripe.Invoice> = async (invoice) => {
  const customerId = invoice.customer as string;

  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });
  if (!user) return;

  await db
    .update(users)
    .set({
      subscriptionStatus: 'active',
      gracePeriodStartsAt: null,
      gracePeriodEndsAt: null,
      dunningEmailsSentCount: 0,
      lastDunningEmailSentAt: null,
    })
    .where(eq(users.id, user.id));

  await db.insert(auditLogs).values({
    id: globalThis.crypto.randomUUID(),
    userId: user.id,
    action: 'payment.succeeded',
    resource: 'invoice',
    resourceId: invoice.id,
    metadata: {
      amount: invoice.amount_paid,
      currency: invoice.currency,
      dunning_cleared: !!user.gracePeriodEndsAt,
    },
  });

  await pushUserSnapshot(user.id);
};

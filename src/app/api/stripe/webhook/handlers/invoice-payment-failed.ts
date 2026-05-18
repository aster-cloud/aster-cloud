import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users, auditLogs } from '@/lib/prisma';
import { sendPaymentFailedEmail } from '@/lib/resend';
import { pushUserSnapshot } from '@/lib/snapshot-pusher';
import type { WebhookHandler } from './_shared';

/**
 * PM 决策：Trial 用户支付失败 → 直接降回 Free（不走 21 天 dunning）。
 * 付费用户支付失败 → 进入 21 天 grace period。
 */
export const handleInvoicePaymentFailed: WebhookHandler<Stripe.Invoice> = async (invoice) => {
  const customerId = invoice.customer as string;

  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
  });
  if (!user) return;

  // Trial 路径：立即降级 + 通知
  if (user.plan === 'trial' || user.subscriptionStatus === 'trialing') {
    await db
      .update(users)
      .set({
        plan: 'free',
        subscriptionStatus: 'canceled',
        downgradedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await db.insert(auditLogs).values({
      id: globalThis.crypto.randomUUID(),
      userId: user.id,
      action: 'payment.failed_trial_downgrade',
      resource: 'invoice',
      resourceId: invoice.id,
    });

    if (user.email) {
      await sendPaymentFailedEmail(user.email, user.name || 'there');
    }
    await pushUserSnapshot(user.id);
    return;
  }

  // 付费用户路径：进入 21 天 grace period
  const now = new Date();
  const isFirstFailure = !user.gracePeriodStartsAt;
  const gracePeriodEndsAt = isFirstFailure
    ? new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000)
    : user.gracePeriodEndsAt;

  await db
    .update(users)
    .set({
      subscriptionStatus: 'past_due',
      ...(isFirstFailure
        ? {
            gracePeriodStartsAt: now,
            gracePeriodEndsAt,
            dunningEmailsSentCount: 0,
          }
        : {}),
    })
    .where(eq(users.id, user.id));

  await db.insert(auditLogs).values({
    id: globalThis.crypto.randomUUID(),
    userId: user.id,
    action: 'payment.failed',
    resource: 'invoice',
    resourceId: invoice.id,
    metadata: {
      attempt_count: invoice.attempt_count,
      first_failure: isFirstFailure,
      grace_period_ends_at: gracePeriodEndsAt?.toISOString(),
    },
  });

  // Day 0 邮件由本 webhook 发；Day 3/7/14 由 dunning cron 发
  if (isFirstFailure && user.email) {
    await sendPaymentFailedEmail(user.email, user.name || 'there');
    await db
      .update(users)
      .set({
        dunningEmailsSentCount: 1,
        lastDunningEmailSentAt: now,
      })
      .where(eq(users.id, user.id));
  }

  await pushUserSnapshot(user.id);
};

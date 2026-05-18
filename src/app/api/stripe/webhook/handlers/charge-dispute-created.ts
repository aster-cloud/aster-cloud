import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db, users, auditLogs } from '@/lib/prisma';
import { raiseRiskTier } from '@/lib/risk-tier';
import type { WebhookHandler } from './_shared';

/**
 * Stripe charge dispute（chargeback / 拒付）。
 *
 * 这是强欺诈信号 — 把用户 riskTier +1。配合 ai-anomaly-detection.ts
 * 的封禁路径，让"先付款盗刷再拒付"的攻击模式被两次回写抬高到 tier 3+。
 *
 * 注意：dispute 不直接降级或封禁；Stripe 自带的 evidence 流程交给运营。
 * 我们只动 risk-tier 用于"下次再注册"信号。
 */
export const handleChargeDisputeCreated: WebhookHandler<Stripe.Dispute> = async (dispute) => {
  // Stripe.Dispute.charge 可能是 string id 或 expanded Charge object
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id;

  // 通过 charge 取 customer id（Dispute 没直接带 customer）
  const customerId =
    typeof dispute.charge === 'string' ? null : (dispute.charge.customer as string | null);

  if (!customerId) {
    console.warn(`[stripe.charge.dispute.created] no customer on dispute ${dispute.id}`);
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.stripeCustomerId, customerId),
    columns: { id: true, email: true, riskTier: true },
  });
  if (!user) {
    console.warn(`[stripe.charge.dispute.created] customer ${customerId} not mapped to a user`);
    return;
  }

  const result = await raiseRiskTier(db, user.id, `stripe_dispute:${dispute.reason}`);

  await db.insert(auditLogs).values({
    id: globalThis.crypto.randomUUID(),
    userId: user.id,
    action: 'payment.dispute_created',
    resource: 'dispute',
    resourceId: dispute.id,
    metadata: {
      chargeId,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      status: dispute.status,
      riskTierBefore: result?.from ?? user.riskTier,
      riskTierAfter: result?.to ?? user.riskTier,
    },
    createdAt: new Date(),
  });
};

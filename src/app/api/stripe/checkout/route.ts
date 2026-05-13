import { NextResponse } from 'next/server';
import { auth } from '@/auth';

import { stripe } from '@/lib/stripe';
import {
  CurrencyCode,
  CURRENCY_CONFIG,
  getPlanStripePriceId,
  type PlanType,
  type BillingInterval,
} from '@/lib/plans';

// 验证货币代码
function isValidCurrency(currency: unknown): currency is CurrencyCode {
  return typeof currency === 'string' && currency in CURRENCY_CONFIG;
}

export async function POST(req: Request) {
  try {
    const { plan, interval, currency: rawCurrency, quantity } = (await req.json()) as {
      plan: PlanType;
      interval: BillingInterval;
      currency?: string;
      quantity?: number;
    };

    if (!plan || !interval) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // PM v1.1：Pro 起步 1 席（启用审批流需 ≥2 席，由 plan-quota 在业务路径强制）
    const itemQuantity = Math.max(1, quantity || 1);

    // 验证并默认货币为 USD
    const currency: CurrencyCode = isValidCurrency(rawCurrency) ? rawCurrency : 'USD';

    const session = await auth();
    if (!session?.user?.id || !session.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const email = session.user.email;

    if (plan === 'free') {
      return NextResponse.json(
        { error: 'Cannot checkout for free plan' },
        { status: 400 }
      );
    }

    // 风险等级 gate：tier ≥ 3 禁止自助升级，必须 support 人工放行
    // （防"软删→重注→再付费"洗白循环 + Stripe 拒付链路滥用）
    {
      const { db } = await import('@/lib/prisma');
      const { users } = await import('@/db/schema');
      const { eq } = await import('drizzle-orm');
      const row = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { riskTier: true, riskTierReason: true },
      });
      const { policyForTier } = await import('@/lib/risk-tier');
      const tier = (row?.riskTier ?? 0) as 0 | 1 | 2 | 3 | 4;
      if (!policyForTier(tier).allowStripeCheckout) {
        return NextResponse.json(
          {
            error: 'checkout_blocked_by_risk_tier',
            message: 'Self-service upgrade is not available for this account. Contact support@aster-lang.cloud.',
            reason: row?.riskTierReason ?? null,
          },
          { status: 403 }
        );
      }
    }

    const priceId = getPlanStripePriceId(plan, interval, currency);
    if (!priceId) {
      return NextResponse.json(
        { error: 'Invalid plan, interval, or currency configuration' },
        { status: 400 }
      );
    }

    console.info('[stripe-checkout] creating session', {
      userId,
      email,
      plan,
      interval,
      currency,
      priceId,
      quantity: itemQuantity,
      ts: new Date().toISOString(),
    });

    const sessionResponse = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: itemQuantity,
        },
      ],
      customer_email: email,
      client_reference_id: userId,
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?canceled=true`,
      metadata: {
        userId,
        plan,
        interval,
        currency,
        quantity: String(itemQuantity),
      },
    });

    return NextResponse.json({ url: sessionResponse.url });
  } catch (err) {
    console.error('Checkout session error:', err);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}

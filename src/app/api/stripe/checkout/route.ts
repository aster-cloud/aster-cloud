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

    // Validate quantity for team plan (minimum 3 users)
    const itemQuantity = plan === 'team' ? Math.max(3, quantity || 3) : 1;

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

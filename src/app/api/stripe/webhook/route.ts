import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { CAN_BILLING } from '@/lib/deployment-mode';
import { getStripe } from '@/lib/stripe';
import { handleCheckoutCompleted } from './handlers/checkout-completed';
import { handleSubscriptionCreated } from './handlers/subscription-created';
import { handleSubscriptionUpdated } from './handlers/subscription-updated';
import { handleSubscriptionTrialWillEnd } from './handlers/subscription-trial-will-end';
import { handleSubscriptionDeleted } from './handlers/subscription-deleted';
import { handleInvoicePaymentSucceeded } from './handlers/invoice-payment-succeeded';
import { handleInvoicePaymentFailed } from './handlers/invoice-payment-failed';
import { handleChargeDisputeCreated } from './handlers/charge-dispute-created';

type AnyHandler = (data: Stripe.Event.Data.Object, ctx: object) => Promise<void>;

const handlers: Record<string, AnyHandler> = {
  'checkout.session.completed': handleCheckoutCompleted as AnyHandler,
  'customer.subscription.created': handleSubscriptionCreated as AnyHandler,
  'customer.subscription.updated': handleSubscriptionUpdated as AnyHandler,
  'customer.subscription.trial_will_end': handleSubscriptionTrialWillEnd as AnyHandler,
  'customer.subscription.deleted': handleSubscriptionDeleted as AnyHandler,
  'invoice.payment_succeeded': handleInvoicePaymentSucceeded as AnyHandler,
  'invoice.payment_failed': handleInvoicePaymentFailed as AnyHandler,
  'charge.dispute.created': handleChargeDisputeCreated as AnyHandler,
};

export async function POST(req: Request) {
  // On-prem 部署不接 Stripe；返回 404 不泄露端点存在。
  if (!CAN_BILLING) {
    return new NextResponse(null, { status: 404 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');
  if (!signature) {
    console.error('Missing stripe-signature header');
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const stripe = await getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    const handler = handlers[event.type];
    if (handler) {
      await handler(event.data.object, {});
    } else {
      console.log(`Unhandled event type: ${event.type}`);
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}

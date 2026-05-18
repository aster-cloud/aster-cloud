/* @deployment-mode-hot-gate
 * reason: direct __DEPLOYMENT_MODE__ macro at handler top lets terser
 *         fully eliminate the SaaS-only function body (including
 *         STRIPE_WEBHOOK_SECRET literal) from on-prem bundles.
 */
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
  // 直接 macro 检查（不是经 import 的 CAN_BILLING 常量）—— 让 terser
  // 把整个 webhook 处理函数体在 on-prem build 中折叠成一个 404 返回。
  // 否则 STRIPE_WEBHOOK_SECRET 字面量会残留在 bundle 里（无害但不干净）。
  // 详见 verify-on-prem-bundle.ts 设计依据 + spike report §3.3。
  if (__DEPLOYMENT_MODE__ !== 'saas') {
    return new NextResponse(null, { status: 404 });
  }
  // CAN_BILLING 仍然保留作为冗余保险（PR-9 ESLint 规则也允许）；
  // 直接 macro 是真正消除字节码的，CAN_BILLING 是文档化的语义。
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

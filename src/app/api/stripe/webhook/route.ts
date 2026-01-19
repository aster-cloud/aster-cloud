import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { db, users, auditLogs } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';


export async function POST(req: Request) {
  // Validate webhook secret is configured
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    );
  }

  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');

  // Validate signature header exists
  if (!signature) {
    console.error('Missing stripe-signature header');
    return NextResponse.json(
      { error: 'Missing signature' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const plan = session.metadata?.plan as 'pro' | 'team';

        if (userId && customerId && subscriptionId) {
          await db
            .update(users)
            .set({
              plan: plan || 'pro',
              stripeCustomerId: customerId,
              subscriptionId: subscriptionId,
              subscriptionStatus: 'active',
              // Clear trial dates when subscribing
              trialStartedAt: null,
              trialEndsAt: null,
            })
            .where(eq(users.id, userId));
          console.log(`User ${userId} upgraded to ${plan}`);
        }
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const user = await db.query.users.findFirst({
          where: eq(users.stripeCustomerId, customerId),
        });

        if (user) {
          await db
            .update(users)
            .set({
              subscriptionId: subscription.id,
              subscriptionStatus: subscription.status as
                | 'active'
                | 'past_due'
                | 'canceled'
                | 'incomplete'
                | 'incomplete_expired'
                | 'trialing'
                | 'unpaid'
                | 'paused',
            })
            .where(eq(users.id, user.id));
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const user = await db.query.users.findFirst({
          where: eq(users.stripeCustomerId, customerId),
        });

        if (user) {
          // Determine plan from price ID
          const priceId = subscription.items.data[0]?.price.id;
          let plan: 'pro' | 'team' = 'pro';

          if (priceId?.includes('team')) {
            plan = 'team';
          }

          await db
            .update(users)
            .set({
              plan: subscription.status === 'active' ? plan : 'free',
              subscriptionStatus: subscription.status as
                | 'active'
                | 'past_due'
                | 'canceled'
                | 'incomplete'
                | 'incomplete_expired'
                | 'trialing'
                | 'unpaid'
                | 'paused',
            })
            .where(eq(users.id, user.id));
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const user = await db.query.users.findFirst({
          where: eq(users.stripeCustomerId, customerId),
        });

        if (user) {
          await db
            .update(users)
            .set({
              plan: 'free',
              subscriptionId: null,
              subscriptionStatus: 'canceled',
            })
            .where(eq(users.id, user.id));

          // Create audit log
          await db.insert(auditLogs).values({
            id: globalThis.crypto.randomUUID(),
            userId: user.id,
            action: 'subscription.cancelled',
            resource: 'subscription',
            resourceId: subscription.id,
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const user = await db.query.users.findFirst({
          where: eq(users.stripeCustomerId, customerId),
        });

        if (user) {
          // Create audit log for payment
          await db.insert(auditLogs).values({
            id: globalThis.crypto.randomUUID(),
            userId: user.id,
            action: 'payment.succeeded',
            resource: 'invoice',
            resourceId: invoice.id,
            metadata: {
              amount: invoice.amount_paid,
              currency: invoice.currency,
            },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const user = await db.query.users.findFirst({
          where: eq(users.stripeCustomerId, customerId),
        });

        if (user) {
          // Update subscription status
          await db
            .update(users)
            .set({
              subscriptionStatus: 'past_due',
            })
            .where(eq(users.id, user.id));

          // Create audit log
          await db.insert(auditLogs).values({
            id: globalThis.crypto.randomUUID(),
            userId: user.id,
            action: 'payment.failed',
            resource: 'invoice',
            resourceId: invoice.id,
          });

          // TODO: Send payment failed email
          console.log(`Payment failed for user ${user.email}`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

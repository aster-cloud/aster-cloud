import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, users } from '@/lib/prisma';
import { getStripe } from '@/lib/stripe';
import { eq } from 'drizzle-orm';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://aster-lang.cloud';

/**
 * POST /api/stripe/portal
 * 创建 Stripe 客户门户会话，重定向用户管理订阅
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No active subscription found' },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${APP_URL}/billing`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error('Error creating portal session:', error);
    return NextResponse.json(
      { error: 'Failed to create portal session' },
      { status: 500 }
    );
  }
}

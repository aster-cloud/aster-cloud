// 用户 dunning 状态查询（dashboard 横幅用）
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, users } from '@/lib/prisma';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: {
      subscriptionStatus: true,
      gracePeriodEndsAt: true,
      downgradedAt: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    subscriptionStatus: user.subscriptionStatus ?? null,
    gracePeriodEndsAt: user.gracePeriodEndsAt?.toISOString() ?? null,
    downgradedAt: user.downgradedAt?.toISOString() ?? null,
  });
}

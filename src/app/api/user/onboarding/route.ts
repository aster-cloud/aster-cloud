import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDb, users } from '@/lib/prisma';
import { eq } from 'drizzle-orm';

/**
 * POST /api/user/onboarding
 * 保存 onboarding 偏好到用户资料
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { useCase, goals } = await req.json();

  if (!useCase || !Array.isArray(goals)) {
    return NextResponse.json(
      { error: 'useCase (string) and goals (string[]) are required' },
      { status: 400 }
    );
  }

  const db = getDb();
  await db
    .update(users)
    .set({
      onboardingUseCase: useCase,
      onboardingGoals: goals,
      onboardingCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({ success: true });
}

/**
 * GET /api/user/onboarding
 * 获取 onboarding 偏好
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: {
      onboardingUseCase: true,
      onboardingGoals: true,
      onboardingCompletedAt: true,
    },
  });

  return NextResponse.json({
    useCase: user?.onboardingUseCase,
    goals: user?.onboardingGoals,
    completedAt: user?.onboardingCompletedAt,
  });
}

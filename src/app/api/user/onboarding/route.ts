import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, users } from '@/lib/prisma';
import { eq } from 'drizzle-orm';

/**
 * POST /api/user/onboarding
 * 保存 onboarding 偏好到用户资料
 */
export async function POST(req: Request) {
  try {
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
  } catch (error) {
    console.error('Error saving onboarding:', error);
    return NextResponse.json(
      { error: 'Failed to save onboarding preferences' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/user/onboarding
 * 获取 onboarding 偏好
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
  } catch (error) {
    console.error('Error fetching onboarding:', error);
    return NextResponse.json(
      { error: 'Failed to fetch onboarding preferences' },
      { status: 500 }
    );
  }
}

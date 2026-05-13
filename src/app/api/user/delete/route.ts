import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { GRACE_PERIOD_DAYS, softDeleteUser } from '@/lib/user-lifecycle';

// DELETE /api/user/delete - 软删当前用户。30 天 grace 期内同邮箱重登可复活；
// 过期后 cron /api/cron/user-purge 物理清理。
export async function DELETE() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await softDeleteUser(db, session.user.id);

    return NextResponse.json({
      success: true,
      gracePeriodDays: GRACE_PERIOD_DAYS,
      message: `Account scheduled for permanent deletion in ${GRACE_PERIOD_DAYS} days. Signing in with the same email before then will restore it.`,
    });
  } catch (error) {
    console.error('Error deleting account:', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}

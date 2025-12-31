import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getUsageStats } from '@/lib/usage';

// GET /api/user/usage - Get current user's usage stats
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stats = await getUsageStats(session.user.id);

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching usage:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

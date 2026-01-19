import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, teams, users } from '@/lib/prisma';
import { eq } from 'drizzle-orm';

// DELETE /api/user/delete - Delete current user's account
export async function DELETE() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Delete user and all related data (cascading delete handles most relations)
    // Note: Team ownership needs special handling
    const ownedTeams = await db.query.teams.findMany({
      where: eq(teams.ownerId, userId),
      columns: { id: true },
    });

    // Delete owned teams first (this will cascade to team members, invitations, etc.)
    if (ownedTeams.length > 0) {
      await db.delete(teams).where(eq(teams.ownerId, userId));
    }

    // Delete the user (cascades to accounts, sessions, policies, executions, etc.)
    await db.delete(users).where(eq(users.id, userId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting account:', error);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { db, users } from '@/lib/prisma';

/**
 * GET /api/user/me
 *
 * "Who am I?" — minimal session-derived profile. Useful for:
 *   - client-side conditional UI (show admin link only if isAdmin)
 *   - debugging why an admin-gated page returns 404 (was this user
 *     actually flagged as isAdmin?)
 *
 * Returns the session user augmented with the few server-side flags
 * the client genuinely needs to render correctly. Anything sensitive
 * (password hash, audit fields) is deliberately NOT returned.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const u = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      email: true,
      name: true,
      isAdmin: true,
      plan: true,
      createdAt: true,
    },
  });
  if (!u) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  return NextResponse.json({
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    plan: u.plan,
    createdAt: u.createdAt.toISOString(),
  });
}

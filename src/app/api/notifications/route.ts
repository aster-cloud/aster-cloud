/*
 * GET /api/notifications — list user's notifications.
 *
 * Returns a normalized feed; the bell renders the first ~10 items
 * inline + a "View all" link. The full inbox surface is future work.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listNotifications } from '@/lib/notifications';
import { errorEnvelope } from '@/lib/api/error-envelope';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const unreadOnly = url.searchParams.get('unread') === '1';

    const rows = await listNotifications(session.user.id, {
      limit: Number.isFinite(limit) ? limit : 20,
      unreadOnly,
    });
    return NextResponse.json({ notifications: rows });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not load your notifications. Please retry.',
    });
    console.error(
      '[notifications GET] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

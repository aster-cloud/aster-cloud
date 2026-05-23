/*
 * GET /api/notifications/count — unread count for the topbar bell.
 *
 * Polled by the bell client on a short interval (30s). Bounded at 50
 * server-side; the UI surfaces "50+" for runaway notification
 * sources (bug surface). Cheap aggregate compared to the full list
 * fetch so we can poll without dragging Hyperdrive.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { countUnreadNotifications } from '@/lib/notifications';
import { errorEnvelope } from '@/lib/api/error-envelope';

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      // Bell on landing or pre-login surfaces — return 0 quietly.
      return NextResponse.json({ count: 0 });
    }
    const count = await countUnreadNotifications(session.user.id);
    return NextResponse.json({ count });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not load unread count.',
    });
    console.error(
      '[notifications count GET] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

/*
 * POST /api/notifications/mark-read
 *
 * Body:
 *   { id: "<uuid>" } — mark a single notification as read
 *   {}              — mark all of the user's notifications as read
 *
 * The bell calls the all-mark on drop-down open so the unread badge
 * clears as soon as the user has *seen* the list, even if they don't
 * explicitly dismiss every item.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { markNotificationsRead } from '@/lib/notifications';
import { errorEnvelope } from '@/lib/api/error-envelope';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    await markNotificationsRead(session.user.id, { id: body.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not mark notifications as read.',
    });
    console.error(
      '[notifications mark-read POST] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

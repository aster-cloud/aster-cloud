/*
 * POST /api/notifications/dismiss — remove a notification.
 *
 * Body: { id: "<uuid>" }
 *
 * Distinct from mark-read: dismiss deletes the row, mark-read sets
 * readAt. Dismiss is exposed for "X this from my feed" affordances;
 * the bell only mark-reads on open.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dismissNotification } from '@/lib/notifications';
import { errorEnvelope } from '@/lib/api/error-envelope';

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = (await req.json()) as { id?: string };
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    await dismissNotification(session.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not dismiss the notification.',
    });
    console.error(
      '[notifications dismiss POST] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

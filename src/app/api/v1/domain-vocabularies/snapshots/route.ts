/**
 * GET /api/v1/domain-vocabularies/snapshots (B12)
 *
 * Returns the caller's own snapshots, optionally filtered by domain + locale.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { errorEnvelope } from '@/lib/api/error-envelope';
import { listOwnerSnapshots } from '@/lib/domain-vocabulary-snapshot';

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return errorEnvelope({
        status: 401,
        code: 'unauthorized',
        message: 'Sign in required',
      });
    }
    const url = new URL(req.url);
    const snapshots = await listOwnerSnapshots(session.user.id, {
      domain: url.searchParams.get('domain') ?? undefined,
      locale: url.searchParams.get('locale') ?? undefined,
    });
    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error('[domain-vocabularies snapshots GET]', error);
    return errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not load snapshots. Please retry.',
    });
  }
}

/**
 * GET /api/v1/domain-vocabularies/snapshots/[id]
 *
 * Returns the snapshot's resolved terms + a set-comparison against the
 * caller's current active set so the UI (F7) can render a diff preview
 * before a rollback.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { errorEnvelope } from '@/lib/api/error-envelope';
import { VocabularyError } from '@/lib/domain-vocabulary';
import { getSnapshotDiff } from '@/lib/domain-vocabulary-snapshot';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return errorEnvelope({
        status: 401,
        code: 'unauthorized',
        message: 'Sign in required',
      });
    }
    const { id } = await params;
    if (!id) {
      return errorEnvelope({
        status: 400,
        code: 'validation_failed',
        message: 'snapshotId is required',
      });
    }
    const diff = await getSnapshotDiff(session.user.id, id);
    return NextResponse.json(diff);
  } catch (error) {
    if (error instanceof VocabularyError && error.code === 'not_found') {
      return errorEnvelope({
        status: 404,
        code: error.code,
        message: error.message,
      });
    }
    console.error('[domain-vocabularies snapshot detail]', error);
    return errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not load the snapshot. Please retry.',
    });
  }
}

/**
 * POST /api/v1/domain-vocabularies/snapshots/[id]/rollback (B12)
 *
 * Apply the snapshot's term set as the caller's active vocabulary. The
 * service returns counts of added/removed/unchanged links so the UI can
 * render a friendly summary toast.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { errorEnvelope } from '@/lib/api/error-envelope';
import {
  IdempotencyConflictError,
  IdempotencyKeyInvalidError,
  withIdempotency,
} from '@/lib/api/idempotency';
import { VocabularyError } from '@/lib/domain-vocabulary';
import { rollbackToSnapshot } from '@/lib/domain-vocabulary-snapshot';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function vocabErrorToEnvelope(error: VocabularyError): NextResponse {
  switch (error.code) {
    case 'not_found':
      return errorEnvelope({ status: 404, code: error.code, message: error.message });
    case 'snapshot_archived':
      return errorEnvelope({ status: 409, code: error.code, message: error.message });
    default:
      return errorEnvelope({ status: 500, code: error.code, message: error.message });
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({
      status: 401,
      code: 'unauthorized',
      message: 'Sign in required',
    });
  }
  const { id: snapshotId } = await params;
  if (!snapshotId) {
    return errorEnvelope({
      status: 400,
      code: 'validation_failed',
      message: 'snapshotId is required',
    });
  }

  try {
    const userId = session.user.id;
    const idem = await withIdempotency(
      req,
      {
        userId,
        routeKey: `POST /api/v1/domain-vocabularies/snapshots/${snapshotId}/rollback`,
      },
      async () => {
        const result = await rollbackToSnapshot(userId, snapshotId);
        return { status: 200, body: { snapshotId, ...result } };
      },
    );
    return NextResponse.json(idem.body, { status: idem.status });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return errorEnvelope({ status: 409, code: error.code, message: error.message });
    }
    if (error instanceof IdempotencyKeyInvalidError) {
      return errorEnvelope({ status: 400, code: error.code, message: error.message });
    }
    if (error instanceof VocabularyError) return vocabErrorToEnvelope(error);
    console.error('[domain-vocabularies snapshots rollback]', error);
    return errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not rollback to the snapshot. Please retry; the failure has been logged.',
    });
  }
}

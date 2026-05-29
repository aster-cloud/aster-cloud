/**
 * POST /api/v1/domain-vocabularies/bulk/jobs (B11)
 *
 * Enqueue an async bulk import. Returns the jobId immediately; clients
 * poll GET /bulk/jobs/[id] for progress.
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { errorEnvelope } from '@/lib/api/error-envelope';
import {
  IdempotencyConflictError,
  IdempotencyKeyInvalidError,
  withIdempotency,
} from '@/lib/api/idempotency';
import {
  BULK_ASYNC_MAX_ROWS,
  VocabularyError,
} from '@/lib/domain-vocabulary';
import { enqueueBulkJob } from '@/lib/domain-vocabulary-jobs';
import {
  RateLimitPresets,
  checkRateLimit,
  getRateLimitHeaders,
} from '@/lib/rate-limit';

interface BulkRequestBody {
  terms?: unknown;
}

function vocabErrorToEnvelope(error: VocabularyError): NextResponse {
  switch (error.code) {
    case 'plan_gate_required':
      return errorEnvelope({ status: 403, code: error.code, message: error.message });
    case 'validation_failed':
      return errorEnvelope({ status: 400, code: error.code, message: error.message });
    default:
      return errorEnvelope({ status: 500, code: error.code, message: error.message });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({ status: 401, code: 'unauthorized', message: 'Sign in required' });
  }
  const userId = session.user.id;

  const rate = checkRateLimit(`lexicon-bulk:${userId}`, RateLimitPresets.LEXICON_BULK);
  if (!rate.allowed) {
    return errorEnvelope({
      status: 429,
      code: 'rate_limited',
      message: 'Too many bulk imports — please retry after the window resets.',
      headers: getRateLimitHeaders(rate, RateLimitPresets.LEXICON_BULK),
    });
  }

  let parsedBody: BulkRequestBody;
  try {
    parsedBody = (await req.clone().json()) as BulkRequestBody;
  } catch {
    return errorEnvelope({
      status: 400,
      code: 'validation_failed',
      message: 'Request body must be valid JSON',
    });
  }
  if (!Array.isArray(parsedBody.terms) || parsedBody.terms.length === 0) {
    return errorEnvelope({
      status: 400,
      code: 'validation_failed',
      message: '"terms" must be a non-empty array',
    });
  }
  if (parsedBody.terms.length > BULK_ASYNC_MAX_ROWS) {
    return errorEnvelope({
      status: 400,
      code: 'validation_failed',
      message: `async bulk import accepts at most ${BULK_ASYNC_MAX_ROWS} rows`,
    });
  }

  // Cap the serialized payload size so a caller cannot store arbitrarily
  // large JSONB into LexiconBulkJob.inputJson. 4 MiB is generous: 10k rows
  // at 400B average row JSON ≈ 4MB and still well under Postgres TOAST
  // limits.
  const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
  let serializedSize = 0;
  try {
    serializedSize = new TextEncoder().encode(JSON.stringify(parsedBody.terms)).length;
  } catch {
    return errorEnvelope({
      status: 400,
      code: 'validation_failed',
      message: 'Could not serialize "terms" for storage',
    });
  }
  if (serializedSize > MAX_PAYLOAD_BYTES) {
    return errorEnvelope({
      status: 400,
      code: 'validation_failed',
      message: `serialized payload exceeds ${MAX_PAYLOAD_BYTES} bytes`,
    });
  }
  const idempotencyHeader =
    req.headers.get('Idempotency-Key') ?? req.headers.get('idempotency-key') ?? undefined;

  try {
    const idem = await withIdempotency(
      req,
      { userId, routeKey: 'POST /api/v1/domain-vocabularies/bulk/jobs' },
      async () => {
        const enq = await enqueueBulkJob(
          userId,
          parsedBody.terms as unknown[],
          idempotencyHeader,
        );
        return { status: 202, body: enq };
      },
    );
    return NextResponse.json(idem.body, {
      status: idem.status,
      headers: getRateLimitHeaders(rate, RateLimitPresets.LEXICON_BULK),
    });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return errorEnvelope({ status: 409, code: error.code, message: error.message });
    }
    if (error instanceof IdempotencyKeyInvalidError) {
      return errorEnvelope({ status: 400, code: error.code, message: error.message });
    }
    if (error instanceof VocabularyError) return vocabErrorToEnvelope(error);
    console.error('[domain-vocabularies bulk/jobs POST]', error);
    return errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not enqueue the bulk import. Please retry; the failure has been logged.',
    });
  }
}

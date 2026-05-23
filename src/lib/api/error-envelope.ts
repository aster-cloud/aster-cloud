/**
 * Structured error envelope for /api routes.
 *
 * Goal: every BFF route returns the same shape on failure, so the
 * client retry path and on-call log lookup share one contract:
 *
 *   {
 *     "error": {
 *       "code":      "service_unavailable" | "unauthorized" | …,
 *       "message":   "human-readable summary",
 *       "requestId": "uuid-v4"
 *     }
 *   }
 *
 * The same `requestId` is also emitted on the `x-request-id`
 * response header (so callers that don't parse the body — health
 * checks, log aggregators — still see the correlation key).
 *
 * Pair with admin/error.tsx and dashboard/error.tsx: those segments
 * already surface `error.digest` as the Error ID. When a server
 * throw is caught here and the response body is parsed client-side
 * via apiFetch / ApiError, the body's requestId can be displayed
 * with the same Error-ID treatment.
 *
 * Why not reuse Next.js's `error.digest`:
 *   `digest` is minted only when Next's server component machinery
 *   bubbles a throw to the boundary. A BFF route that catches its
 *   own throws (the P0-5 pattern) never produces a digest — the
 *   caller would see a generic message without a correlation ID.
 *   This envelope mints its own UUID per failure so the contract
 *   is uniform regardless of where the failure originated.
 */

import { NextResponse } from 'next/server';

export interface ErrorEnvelopeBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export interface ErrorEnvelopeOptions {
  /** HTTP status. Defaults to 500. */
  status?: number;
  /** Stable machine-parseable code (e.g. `unauthorized`, `service_unavailable`). */
  code: string;
  /** Human-readable summary. Never include stack-trace text. */
  message: string;
  /**
   * Optional request id override — e.g. when an upstream proxy
   * already minted one and we want to preserve correlation across
   * the BFF → upstream hop. When omitted, a fresh UUID is generated.
   */
  requestId?: string;
  /** Extra response headers (CORS, rate-limit, etc.) merged on top of x-request-id. */
  headers?: HeadersInit;
}

/**
 * Build a NextResponse carrying a structured error envelope.
 * Always emits an `x-request-id` header containing the same value
 * that appears in the body.
 */
export function errorEnvelope(opts: ErrorEnvelopeOptions): NextResponse {
  const requestId = opts.requestId ?? crypto.randomUUID();
  const body: ErrorEnvelopeBody = {
    error: {
      code: opts.code,
      message: opts.message,
      requestId,
    },
  };
  // Merge caller-provided headers but always override x-request-id
  // so the contract holds (envelope.body.requestId === header).
  const merged = new Headers(opts.headers);
  merged.set('x-request-id', requestId);
  merged.set('content-type', 'application/json');
  return NextResponse.json(body, {
    status: opts.status ?? 500,
    headers: merged,
  });
}

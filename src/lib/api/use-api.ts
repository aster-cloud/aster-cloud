'use client';

/**
 * useApi — typed SWR wrapper for our internal /api routes.
 *
 * Why wrap SWR rather than call useSWR directly everywhere:
 *   - One fetcher that does the right thing (JSON parse, throw on
 *     !res.ok, surface backend error.message). No more 14 copies of
 *     "if (!res.ok) throw new Error(data.error || …)" scattered across
 *     useEffect bodies.
 *   - One place to layer cross-cutting behavior later (request-id,
 *     auth refresh, tenant headers).
 *   - Type-safe response via generic `<T>`.
 *
 * Pass `null` as the path to skip the request (conditional fetching).
 */

import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr';

/** Error thrown by the fetcher when an API response is non-ok. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** Default SWR fetcher — JSON in, JSON out, throw on !ok. */
export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  // Best-effort body parse — some endpoints return empty 204s.
  const body =
    res.headers.get('content-type')?.includes('application/json')
      ? await res.json().catch(() => null)
      : null;
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : null) ||
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : null) ||
      `Request failed: ${res.status}`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

export interface UseApiResult<T> extends Omit<SWRResponse<T, ApiError>, 'data' | 'error'> {
  data: T | undefined;
  error: ApiError | undefined;
  isLoading: boolean;
}

/**
 * Fetch and cache a JSON GET endpoint.
 *
 * Pass `null` to skip — useful when a parent value (e.g. selected team
 * id) isn't ready yet:
 *   const { data } = useApi<Team>(teamId ? `/api/teams/${teamId}` : null);
 */
export function useApi<T>(
  path: string | null,
  config?: SWRConfiguration<T, ApiError>,
): UseApiResult<T> {
  const swr = useSWR<T, ApiError>(path, apiFetch, config);
  return {
    ...swr,
    isLoading: !!path && swr.data === undefined && swr.error === undefined,
  };
}

'use client';

/**
 * useMutation — typed wrapper for non-GET API calls (POST/PUT/DELETE/PATCH).
 *
 * The complement to useApi: where useApi handles read-and-cache with
 * SWR, this hook handles write actions. Exposes:
 *   - mutate(body?) → fires the request; returns parsed JSON on
 *     success, throws ApiError on failure.
 *   - isLoading / error state for UI gating.
 *   - reset() to clear error state without re-firing.
 *
 * Also returns the SWR mutate function for revalidating affected
 * caches after a successful write — pass it `swrKey` paths to
 * invalidate, no manual cache poking.
 *
 * Pattern in a component:
 *   const revoke = useMutation<void>(`/api/api-keys/${id}`, { method: 'DELETE' });
 *   await revoke.mutate();          // success path
 *   await revoke.revalidate('/api/api-keys');  // refresh the list
 */

import { useCallback, useState } from 'react';
import { mutate as swrMutate } from 'swr';
import { ApiError } from './use-api';

export interface UseMutationOptions {
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Override default headers. JSON content-type is added when body is
   *  supplied, unless explicitly overridden here. */
  headers?: Record<string, string>;
}

export interface UseMutationResult<TBody, TResult> {
  /** Trigger the request. Throws ApiError on failure. */
  mutate: (body?: TBody) => Promise<TResult>;
  /** Invalidate one or more SWR cache keys (typically affected lists). */
  revalidate: (keys: string | string[]) => Promise<unknown>;
  isLoading: boolean;
  error: ApiError | undefined;
  /** Last successful response — handy for components that want to
   *  render confirmation text after a write. */
  data: TResult | undefined;
  /** Clear `error` / `data` without re-running. */
  reset: () => void;
}

export function useMutation<TResult = unknown, TBody = unknown>(
  path: string,
  options: UseMutationOptions = {},
): UseMutationResult<TBody, TResult> {
  const { method = 'POST', headers: extraHeaders } = options;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();
  const [data, setData] = useState<TResult | undefined>();

  const mutate = useCallback(
    async (body?: TBody): Promise<TResult> => {
      setIsLoading(true);
      setError(undefined);
      try {
        const hasBody = body !== undefined;
        const headers: Record<string, string> = {
          Accept: 'application/json',
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        };
        const res = await fetch(path, {
          method,
          headers,
          credentials: 'same-origin',
          body: hasBody ? JSON.stringify(body) : undefined,
        });
        const bodyOut =
          res.headers.get('content-type')?.includes('application/json')
            ? await res.json().catch(() => null)
            : null;
        if (!res.ok) {
          const message =
            (bodyOut && typeof bodyOut === 'object' && 'error' in bodyOut
              ? String((bodyOut as { error: unknown }).error)
              : null) ||
            (bodyOut && typeof bodyOut === 'object' && 'message' in bodyOut
              ? String((bodyOut as { message: unknown }).message)
              : null) ||
            `Request failed: ${res.status}`;
          const apiError = new ApiError(message, res.status, bodyOut);
          setError(apiError);
          throw apiError;
        }
        const result = bodyOut as TResult;
        setData(result);
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [path, method, extraHeaders],
  );

  const revalidate = useCallback((keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    return Promise.all(list.map((k) => swrMutate(k)));
  }, []);

  const reset = useCallback(() => {
    setError(undefined);
    setData(undefined);
  }, []);

  return { mutate, revalidate, isLoading, error, data, reset };
}

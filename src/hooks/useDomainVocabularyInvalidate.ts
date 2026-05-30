/**
 * useDomainVocabularyInvalidate — subscribe to vocabulary SSE invalidates.
 *
 * Opens an EventSource against /api/v1/domain-vocabularies/stream and bumps
 * an integer every time an `invalidate` event arrives. Components can key
 * downstream effects (Monaco re-registration, query cache invalidation) on
 * the returned value to trigger a refetch.
 *
 * The connection is single-flight per hook instance and reconnects with a
 * bounded exponential backoff on error. Heartbeats from the server side
 * keep proxies from idling the connection out.
 */

import { useEffect, useState } from 'react';

interface UseInvalidateOptions {
  /** Skip subscribing (e.g., feature-flagged off or anonymous). */
  enabled?: boolean;
  /**
   * Optional filter — only bump `tick` when the event's (domain, locale)
   * matches. When omitted, every invalidate counts.
   */
  match?: { domain?: string; locale?: string };
  /** Override the stream URL (mostly for tests). */
  url?: string;
}

interface InvalidatePayload {
  ownerType: string;
  ownerId: string;
  domain?: string;
  locale?: string;
}

const DEFAULT_URL = '/api/v1/domain-vocabularies/stream';
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function useDomainVocabularyInvalidate(
  options: UseInvalidateOptions = {},
): number {
  const { enabled = true, match, url = DEFAULT_URL } = options;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let cancelled = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = BASE_BACKOFF_MS;

    const connect = () => {
      es = new EventSource(url, { withCredentials: true });
      es.addEventListener('connected', () => {
        // Successful handshake — reset backoff so a later transient drop
        // re-tries fast rather than starting at the long-cooldown value.
        backoff = BASE_BACKOFF_MS;
      });
      es.addEventListener('invalidate', (e: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(e.data) as InvalidatePayload;
          if (matches(payload, match)) {
            setTick((n) => n + 1);
          }
        } catch {
          // Malformed payload — keep listening; ignore this event.
        }
      });
      es.onerror = () => {
        // Either initial-connect failure or a mid-stream drop. EventSource
        // will silently retry on its own, but we control backoff explicitly
        // to keep server load bounded under partial-network outages.
        if (cancelled) return;
        es?.close();
        es = null;
        retryTimer = setTimeout(connect, backoff);
        backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
      };
    };

    connect();
    return () => {
      cancelled = true;
      es?.close();
      es = null;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // Match is intentionally destructured into primitives so the effect
    // doesn't re-subscribe when an unstable object identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, url, match?.domain, match?.locale]);

  return tick;
}

function matches(
  payload: InvalidatePayload,
  filter: UseInvalidateOptions['match'],
): boolean {
  if (!filter) return true;
  if (filter.domain && payload.domain !== filter.domain) return false;
  if (filter.locale && payload.locale !== filter.locale) return false;
  return true;
}

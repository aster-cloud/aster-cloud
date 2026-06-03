'use client';

/**
 * Client-side docs session probe.
 *
 * Calls `/api/docs/session-state` once per docs session, caches the
 * result in `localStorage` for fast subsequent renders, and exposes
 * the auth state via a React Context that any docs subtree can read
 * with `useDocsSession()`.
 *
 * Why client-only:
 *   - Docs RSC must stay PII-free and CDN-cacheable. Reading `auth()`
 *     server-side would force `Vary: Cookie` on the docs HTML and
 *     would risk session.user.email landing in the HTML stream.
 *   - The probe response is `private, no-store` so it never enters
 *     any cache except this hook's localStorage layer.
 *
 * SWR pattern:
 *   - Render the cached state synchronously on mount (no flash between
 *     anonymous and authenticated chrome on every reload).
 *   - **Always revalidate on mount**, even when the cache is fresh.
 *     Without this, signing in or out in another tab would leave docs
 *     showing stale chrome for the lifetime of the tab. The cached
 *     value still drives the initial paint to avoid flicker.
 *   - `clearDocsSessionCache()` is exported for sign-out flows (docs
 *     top-nav sign-out, dashboard sign-out, dedicated logout page).
 *   - `signalDocsSessionRefresh()` is exported for sign-in flows
 *     (credentials success branch, OAuth-landing dashboard layout via
 *     `<DocsSessionSignal />`). Each writes a distinct value to a
 *     shared auth-tick key so open docs tabs can tell sign-out from
 *     sign-in and react accordingly.
 *
 * Failure mode:
 *   - 1 retry with 1 s backoff on transient network/5xx errors.
 *   - After retry exhaustion, fall back to anonymous state — the worst
 *     thing a docs reader can see is an "Open Console" CTA when they're
 *     already signed in (one extra click). PII risk dominates UX risk.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { track, Events } from '@/lib/mixpanel';

const CACHE_KEY = 'aster.docs.session';
const SCHEMA_VERSION = 1;

export type DocsCapabilities = {
  canUsePlayground: boolean;
  canEditPolicies: boolean;
  canViewAudit: boolean;
  hasActiveTeam: boolean;
};

export type DocsSessionAuth =
  | {
      status: 'probing';
    }
  | {
      status: 'authenticated';
      capabilities: DocsCapabilities;
      subjectHash: string;
    }
  | {
      status: 'anonymous';
      capabilities: DocsCapabilities;
    };

/**
 * Anonymous capabilities — playground preview tenant is public.
 * This matches the ANONYMOUS_STATE constant on the server route so the
 * client falls back to the exact same shape on probe failure.
 */
const ANONYMOUS: DocsSessionAuth = {
  status: 'anonymous',
  capabilities: {
    canUsePlayground: true,
    canEditPolicies: false,
    canViewAudit: false,
    hasActiveTeam: false,
  },
};

type CachedEntry = {
  ts: number;
  schemaVersion: number;
  state: DocsSessionAuth;
};

function readCache(): CachedEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(state: DocsSessionAuth): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CachedEntry = {
      ts: Date.now(),
      schemaVersion: SCHEMA_VERSION,
      state,
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage may be disabled (private mode, quota); silently drop.
  }
}

/**
 * Auth transition signals — used by the cross-tab `storage` listener
 * to know how to respond. We bump a dedicated key (`aster.docs.auth-tick`)
 * so the docs tab can revalidate via the probe rather than infer state
 * from the cache shape. Without this distinction the listener could
 * not tell "user signed out" (set anonymous) from "user signed in"
 * (revalidate to authenticated).
 */
const AUTH_TICK_KEY = 'aster.docs.auth-tick';

/**
 * Signal to every open docs tab that the user just signed out. The
 * cache is removed (so a fresh mount paints anonymous immediately)
 * and the auth-tick is bumped with `out` so cross-tab listeners flip
 * to anonymous without doing a network round-trip.
 *
 * Call from: dedicated logout page, dashboard nav sign-out, docs
 * top-nav sign-out, login-page OAuth session-switch.
 */
export function clearDocsSessionCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
    window.localStorage.setItem(AUTH_TICK_KEY, `out:${Date.now()}`);
  } catch {
    // ignore: localStorage may be disabled (private mode, quota).
  }
}

/**
 * Signal to every open docs tab that the user just signed in (or
 * switched accounts). Tabs listening for the auth-tick will run a
 * fresh probe to pick up the new authenticated state rather than
 * displaying stale anonymous chrome. Same-tab callers don't need
 * this — they'll revalidate on next mount anyway.
 *
 * Call from: login-page success branch (credentials + OAuth).
 */
export function signalDocsSessionRefresh(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_TICK_KEY, `in:${Date.now()}`);
  } catch {
    // ignore.
  }
}

async function fetchSessionState(signal: AbortSignal): Promise<DocsSessionAuth> {
  const res = await fetch('/api/docs/session-state', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok && res.status !== 200) {
    // 429 / 503 / network error → caller decides retry or fallback.
    throw new Error(`probe failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    authenticated: boolean;
    capabilities: DocsCapabilities;
    subjectHash: string;
    schemaVersion: number;
  };
  if (data.schemaVersion !== SCHEMA_VERSION) {
    // Server bumped schema — fall back to anonymous until client updates.
    return ANONYMOUS;
  }
  return data.authenticated
    ? {
        status: 'authenticated',
        capabilities: data.capabilities,
        subjectHash: data.subjectHash,
      }
    : ANONYMOUS;
}

const DocsSessionContext = createContext<DocsSessionAuth>({ status: 'probing' });

export function DocsSessionProvider({ children }: { children: ReactNode }) {
  // Render cached state immediately on mount to avoid flashing the
  // anonymous chrome for a logged-in user on every page navigation.
  // The initial render still returns `probing` to keep SSR markup
  // stable; the cached state takes over on the first client effect.
  const [state, setState] = useState<DocsSessionAuth>({ status: 'probing' });
  const probeStartedRef = useRef(false);
  // Monotonic generation counter — bumped on every auth tick. An
  // in-flight probe captures the generation it started under; if a
  // newer tick (e.g. sign-out) bumps the counter while the probe is
  // still resolving, the resolved value is discarded. This closes
  // the race where a stale authenticated response could land after
  // a fresh sign-out.
  const generationRef = useRef(0);

  useEffect(() => {
    if (probeStartedRef.current) return;
    probeStartedRef.current = true;

    const cached = readCache();
    if (cached) {
      setState(cached.state);
    }
    // Always revalidate, even with cached state, so cross-tab sign-in
    // / sign-out reflects in docs chrome on the next mount. The cached
    // value still drives the initial paint to avoid a probing-flash.

    const controller = new AbortController();
    const probeStart = Date.now();
    const probeGen = generationRef.current;
    const run = async () => {
      try {
        const fresh = await fetchSessionState(controller.signal);
        if (probeGen !== generationRef.current) return; // superseded
        setState(fresh);
        writeCache(fresh);
        track(Events.DOCS_SESSION_PROBE, {
          status: 'ok',
          authenticated: fresh.status === 'authenticated',
          latency_ms: Date.now() - probeStart,
        });
      } catch {
        // One retry on transient failure (network glitch, cold start).
        if (controller.signal.aborted) return;
        await new Promise((r) => setTimeout(r, 1_000));
        try {
          const fresh = await fetchSessionState(controller.signal);
          if (probeGen !== generationRef.current) return; // superseded
          setState(fresh);
          writeCache(fresh);
          track(Events.DOCS_SESSION_PROBE, {
            status: 'ok_after_retry',
            authenticated: fresh.status === 'authenticated',
            latency_ms: Date.now() - probeStart,
          });
        } catch {
          // Final fallback: anonymous chrome.
          if (!controller.signal.aborted && probeGen === generationRef.current) {
            setState(ANONYMOUS);
            writeCache(ANONYMOUS);
            track(Events.DOCS_SESSION_PROBE, {
              status: 'failed',
              authenticated: false,
              latency_ms: Date.now() - probeStart,
            });
          }
        }
      }
    };
    void run();

    // Cross-tab sync — two distinct signals:
    //   1. CACHE_KEY changes → mirror the new cache shape (mostly for
    //      future direct cache writes; sign-out also lands here).
    //   2. AUTH_TICK_KEY changes → handle the user's last auth action:
    //        - "out:*" → optimistically set anonymous (and clear local
    //          cache copy so a future mount agrees)
    //        - "in:*"  → revalidate via the probe to pick up the new
    //          authenticated state. We don't synthesize an authenticated
    //          state locally because we don't have the subjectHash or
    //          capabilities — only the server knows them.
    function onStorage(ev: StorageEvent) {
      if (ev.key === CACHE_KEY) {
        const next = readCache();
        if (next) setState(next.state);
        else setState(ANONYMOUS);
        return;
      }
      if (ev.key === AUTH_TICK_KEY) {
        // Bump generation so any in-flight probe is discarded — a
        // stale authenticated response landing after a fresh sign-out
        // would otherwise overwrite ANONYMOUS.
        generationRef.current += 1;
        const tickGen = generationRef.current;
        const value = ev.newValue ?? '';
        if (value.startsWith('out')) {
          setState(ANONYMOUS);
          writeCache(ANONYMOUS);
          return;
        }
        if (value.startsWith('in')) {
          // Revalidate from server — we cannot synthesize the
          // authenticated state without the subjectHash.
          const ctl = new AbortController();
          fetchSessionState(ctl.signal)
            .then((fresh) => {
              if (tickGen !== generationRef.current) return; // superseded
              setState(fresh);
              writeCache(fresh);
            })
            .catch(() => {
              // Best-effort cross-tab refresh — leave state as-is.
            });
        }
      }
    }
    window.addEventListener('storage', onStorage);

    return () => {
      controller.abort();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <DocsSessionContext.Provider value={state}>{children}</DocsSessionContext.Provider>
  );
}

export function useDocsSession(): DocsSessionAuth {
  return useContext(DocsSessionContext);
}

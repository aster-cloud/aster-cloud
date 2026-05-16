'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * localStorage draft persistence for the policy form.
 *
 * Why client-side only: the autosave fires every second on keystroke
 * — pushing that to the server would multiply backend write volume
 * for no real benefit. localStorage is the canonical place for
 * "stuff the user typed but didn't commit." We only escalate to the
 * server on explicit Save.
 *
 * Key shape: `aster:policy-draft:${policyId ?? 'new'}`. Edit and new
 * pages have independent slots so opening /new doesn't blow away
 * an in-progress edit of an existing policy.
 *
 * Schema-versioned (`v: 1`) so future shape changes can deliberately
 * invalidate older drafts instead of mis-parsing them.
 */

export interface PolicyDraftFields {
  name: string;
  description: string;
  content: string;
  isPublic: boolean;
  groupId: string | null;
}

interface StoredDraft extends PolicyDraftFields {
  v: 1;
  savedAt: number; // epoch ms
}

const SCHEMA_VERSION = 1;
const STORAGE_PREFIX = 'aster:policy-draft:';
// Drafts older than this are treated as stale and not surfaced to the
// user — they're more likely to be confusing than helpful (e.g. an
// old session left open in another tab months ago).
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function storageKey(policyId: string | null): string {
  return `${STORAGE_PREFIX}${policyId ?? 'new'}`;
}

function safeRead(key: string): StoredDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed.v !== SCHEMA_VERSION) return null;
    if (Date.now() - parsed.savedAt > STALE_AFTER_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeWrite(key: string, draft: StoredDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Quota exceeded / private mode — silently no-op. Autosave is
    // best-effort, not a hard guarantee.
  }
}

function safeClear(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export interface UsePolicyDraftOptions {
  /** Policy id when editing; null for the new-policy route. */
  policyId: string | null;
  /** Current form state — what to write. */
  fields: PolicyDraftFields;
  /** Snapshot of the server-side fields. Used to decide whether the
   *  current state is "dirty" vs. equal to what's already persisted. */
  baseline: PolicyDraftFields;
  /** Throttle interval for writes (ms). Default 1000. */
  throttleMs?: number;
  /** If true (default), skip persistence. Useful while the form is
   *  still mounting and hasn't loaded user input yet. */
  enabled?: boolean;
}

export interface UsePolicyDraftResult {
  /** True if the current `fields` differ from `baseline`. */
  isDirty: boolean;
  /** Epoch ms of the most recent autosave to localStorage. 0 if none. */
  lastSavedAt: number;
  /** A draft loaded on mount that differs from baseline, or null. */
  pendingDraft: PolicyDraftFields | null;
  /** Apply the loaded draft into the form (clears pendingDraft). */
  acceptPendingDraft: () => void;
  /** Discard the loaded draft (clears storage + pendingDraft). */
  discardPendingDraft: () => void;
  /** Wipe the saved draft. Call after a successful Save. */
  clearDraft: () => void;
}

/** Stable equality check across the 5 draft fields. */
function draftEquals(a: PolicyDraftFields, b: PolicyDraftFields): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.content === b.content &&
    a.isPublic === b.isPublic &&
    a.groupId === b.groupId
  );
}

export function usePolicyDraft({
  policyId,
  fields,
  baseline,
  throttleMs = 1000,
  enabled = true,
}: UsePolicyDraftOptions): UsePolicyDraftResult {
  const key = useMemo(() => storageKey(policyId), [policyId]);
  const [lastSavedAt, setLastSavedAt] = useState(0);

  // Pending draft is loaded in useEffect (NOT useState initializer)
  // to keep the first client render identical to the SSR output —
  // a useState initializer that reads localStorage produces
  // server/client divergence and triggers React hydration error #418.
  const [pendingDraft, setPendingDraft] = useState<PolicyDraftFields | null>(
    null,
  );
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    const stored = safeRead(key);
    if (!stored) return;
    const candidate: PolicyDraftFields = {
      name: stored.name,
      description: stored.description,
      content: stored.content,
      isPublic: stored.isPublic,
      groupId: stored.groupId,
    };
    if (!draftEquals(candidate, baseline)) {
      setPendingDraft(candidate);
    }
    // baseline intentionally omitted — first mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const isDirty = useMemo(
    () => !draftEquals(fields, baseline),
    [fields, baseline],
  );

  // Throttled write loop. `fields` updates on every keystroke; the
  // timer collapses bursts so we hit localStorage at most once per
  // throttleMs window even during fast typing.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFieldsRef = useRef(fields);
  pendingFieldsRef.current = fields;

  useEffect(() => {
    if (!enabled) return;
    // Don't autosave a clean form — it would needlessly clobber a
    // legitimately-saved draft from a previous session.
    if (!isDirty) return;
    if (timerRef.current) return; // throttle window still open

    timerRef.current = setTimeout(() => {
      const snapshot = pendingFieldsRef.current;
      const now = Date.now();
      safeWrite(key, { v: SCHEMA_VERSION, savedAt: now, ...snapshot });
      setLastSavedAt(now);
      timerRef.current = null;
    }, throttleMs);
  }, [fields, isDirty, key, throttleMs, enabled]);

  // Final flush on unmount: if a throttle is still pending, write
  // immediately so the user doesn't lose the last keystrokes on a
  // navigation away.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const snapshot = pendingFieldsRef.current;
        safeWrite(key, {
          v: SCHEMA_VERSION,
          savedAt: Date.now(),
          ...snapshot,
        });
      }
    };
  }, [key]);

  const acceptPendingDraft = useCallback(() => {
    setPendingDraft(null);
  }, []);

  const discardPendingDraft = useCallback(() => {
    safeClear(key);
    setPendingDraft(null);
  }, [key]);

  const clearDraft = useCallback(() => {
    safeClear(key);
    setLastSavedAt(0);
  }, [key]);

  return {
    isDirty,
    lastSavedAt,
    pendingDraft,
    acceptPendingDraft,
    discardPendingDraft,
    clearDraft,
  };
}

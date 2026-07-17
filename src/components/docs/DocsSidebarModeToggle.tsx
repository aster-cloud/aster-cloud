'use client';

/**
 * Segmented control at the top of the docs sidebar that flips between
 * the reference tree (default) and the task-oriented browse mode.
 *
 * Why localStorage instead of URL:
 *   - The mode is a *display* preference, not part of any page's
 *     identity. URL state would mean every internal link has to
 *     carry the toggle to avoid resetting it, and breadcrumb /
 *     sharing semantics get murkier.
 *   - localStorage gives the same persistence guarantees we use for
 *     the docs session cache (Phase 1) and visit tracking (Phase 6
 *     personalized home).
 *
 * SSR-stable: the initial render uses 'reference' so the server-
 * rendered HTML matches the first paint regardless of the user's
 * stored preference. A useEffect reads the stored value and updates
 * after hydration. Tab swap is instant but a single re-render —
 * acceptable for a navigation surface.
 *
 * Telemetry: emits `docs_task_view_switched` so the funnel can show
 * how often task mode is engaged. Switch direction and the previous
 * mode are recorded; no PII.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@aster-cloud/ui';
import { track, Events } from '@/lib/mixpanel';

export type SidebarMode = 'reference' | 'tasks';

const STORAGE_KEY = 'aster.docs.sidebar.mode';
const SCHEMA_VERSION = 1;

type StoredEnvelope = {
  schemaVersion: number;
  mode: SidebarMode;
};

/**
 * Read the stored mode. The envelope shape mirrors
 * `use-visit-tracking.ts` so future migrations follow a single
 * pattern. Falls back to `'reference'` when storage is unavailable,
 * the schema version doesn't match, or the value is malformed.
 */
export function readStoredMode(): SidebarMode {
  if (typeof window === 'undefined') return 'reference';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 'reference';
    const parsed = JSON.parse(raw) as StoredEnvelope;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return 'reference';
    return parsed.mode === 'tasks' ? 'tasks' : 'reference';
  } catch {
    return 'reference';
  }
}

function writeStoredMode(mode: SidebarMode): void {
  if (typeof window === 'undefined') return;
  try {
    const envelope: StoredEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      mode,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // ignore.
  }
}

type Props = {
  mode: SidebarMode;
  onChange: (next: SidebarMode) => void;
};

export function DocsSidebarModeToggle({ mode, onChange }: Props) {
  const t = useTranslations();
  // The hook (`useSidebarMode`) owns persistence + telemetry — the
  // toggle simply requests a new mode through onChange. Doing both
  // here previously caused duplicate localStorage writes and double
  // `docs_task_view_switched` events (Phase 6 audit).
  const handle = (next: SidebarMode) => {
    if (next === mode) return;
    onChange(next);
  };

  // ARIA radio-group arrow-key behavior: Left/Up moves to the
  // previous radio, Right/Down to the next, both wrapping. We
  // mirror only the two values we render so the implementation is
  // bounded.
  const onKey = (ev: React.KeyboardEvent<HTMLButtonElement>) => {
    if (
      ev.key !== 'ArrowLeft' &&
      ev.key !== 'ArrowRight' &&
      ev.key !== 'ArrowUp' &&
      ev.key !== 'ArrowDown'
    ) {
      return;
    }
    ev.preventDefault();
    const next: SidebarMode = mode === 'reference' ? 'tasks' : 'reference';
    handle(next);
  };

  return (
    // `radiogroup` + `radio` is a better fit than `tablist`/`tab`
    // for a binary visual preference control: the ARIA tabs pattern
    // expects tabpanels + arrow-key navigation, neither of which
    // applies to a segmented toggle that re-renders the sidebar body
    // in place. We provide the radio-group arrow-key behavior so
    // keyboard users get the same affordance as a native radio.
    <div
      role="radiogroup"
      aria-label={t('docs.sidebar.modeToggleLabel')}
      className="mb-4 inline-flex w-full rounded-md border border-border bg-bg-subtle p-0.5 text-xs"
    >
      {(['reference', 'tasks'] as SidebarMode[]).map((m) => {
        const selected = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={onKey}
            onClick={() => handle(m)}
            className={cn(
              'flex-1 rounded px-2 py-1 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              selected
                ? 'bg-bg text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {t(m === 'reference' ? 'docs.sidebar.modeReference' : 'docs.sidebar.modeTasks')}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Convenience hook to read + persist the mode. Returns the current
 * mode and a setter; the setter writes through to localStorage and
 * emits the telemetry event so call sites don't have to.
 */
export function useSidebarMode(): [SidebarMode, (next: SidebarMode) => void] {
  const [mode, setModeState] = useState<SidebarMode>('reference');

  useEffect(() => {
    const stored = readStoredMode();
    if (stored !== mode) {
      // 挂载时用 localStorage 持久值水合 mode（SSR 默认 'reference'，客户端读真值）——属合法的外部→状态同步。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModeState(stored);
    }
    // Cross-tab sync — another tab flipping the toggle updates this
    // one without a refresh.
    function onStorage(ev: StorageEvent) {
      if (ev.key !== STORAGE_KEY) return;
      const next = readStoredMode();
      setModeState(next);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMode = (next: SidebarMode) => {
    writeStoredMode(next);
    track(Events.DOCS_TASK_VIEW_SWITCHED, { from: mode, to: next });
    setModeState(next);
  };

  return [mode, setMode];
}

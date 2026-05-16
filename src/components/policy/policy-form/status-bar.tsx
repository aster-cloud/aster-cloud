'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Footer status bar — a one-line summary of the editor state plus
 * always-visible shortcut hints. Lives at the bottom of the IDE
 * layout, matching the convention of VS Code / JetBrains.
 *
 * Information density is deliberate: line count, CNL locale,
 * save state, and the two most-used shortcut hints. Anything more
 * earns its place by becoming a "next action" the user might want
 * (added in PR-2 when we add compile status).
 */

export interface StatusBarProps {
  /** Editor body — used to count lines. */
  content: string;
  /** CNL locale label, e.g. 'en' / 'zh' / 'de'. */
  cnlLocale: string;
  /** True when the form has unsaved changes. */
  isDirty: boolean;
  /** Epoch ms of the last localStorage autosave; 0 if none. */
  lastSavedAt: number;
}

export function StatusBar({
  content,
  cnlLocale,
  isDirty,
  lastSavedAt,
}: StatusBarProps) {
  const t = useTranslations('policies.form');
  const lineCount = content.length === 0 ? 0 : content.split('\n').length;
  const ago = useTimeAgo(lastSavedAt);

  return (
    <footer
      className="flex items-center gap-3 border-t border-border bg-bg-subtle px-3 py-1.5 text-xs text-fg-muted"
      role="status"
      aria-live="polite"
    >
      <span>{t('statusLines', { count: lineCount })}</span>
      <Separator />
      <span>{t('statusLocale', { locale: cnlLocale.toUpperCase() })}</span>
      <Separator />
      {isDirty ? (
        <span className="text-warning-fg">{t('statusUnsaved')}</span>
      ) : lastSavedAt > 0 ? (
        <span>{t('statusSavedAgo', { time: ago })}</span>
      ) : null}

      {/* Right-aligned shortcut hints */}
      <span className="ml-auto flex items-center gap-3">
        <ShortcutHint label={t('statusSaveHint')} />
        <Separator />
        <ShortcutHint label={t('statusPaletteHint')} />
      </span>
    </footer>
  );
}

function Separator() {
  return (
    <span aria-hidden className="text-fg-subtle">
      ·
    </span>
  );
}

function ShortcutHint({ label }: { label: string }) {
  return <span className="font-mono text-[11px]">{label}</span>;
}

/**
 * Minimal "n seconds ago" formatter. We deliberately don't pull in
 * a date-fns dep for one line of relative time. Re-render every
 * 30s so the value doesn't lie for long.
 */
function useTimeAgo(epochMs: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!epochMs) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [epochMs]);

  if (!epochMs) return '';
  const diffSec = Math.max(0, Math.round((now - epochMs) / 1000));
  if (diffSec < 5) return 'now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/components/ui';

/**
 * Three-state theme toggle (light / dark / system). Rendered in the
 * dashboard top nav. Cycles forward on each click so it stays a single
 * affordance instead of a popover — fewer pixels, fewer clicks.
 *
 * Mount guard: `next-themes` reads localStorage at mount, so the
 * resolved theme is `undefined` on the first server render. Returning
 * a non-interactive placeholder of the same size avoids a layout shift
 * and a hydration mismatch on the icon.
 */
const ORDER = ['light', 'dark', 'system'] as const;

export interface ThemeToggleLabels {
  /** Tooltip / aria-label for each state. Localized by the caller. */
  light: string;
  dark: string;
  system: string;
}

export function ThemeToggle({ labels }: { labels: ThemeToggleLabels }) {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // next-themes 挂载守卫：仅在客户端挂载后置 mounted=true，规避 SSR 与
  // hydration 主题不一致。属一次性挂载态同步，非级联 setState。
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const current = (theme as (typeof ORDER)[number] | undefined) ?? 'system';
  const handleCycle = () => {
    const idx = ORDER.indexOf(current);
    const next = ORDER[(idx + 1) % ORDER.length];
    setTheme(next);
  };

  // Match the rendered button's footprint so the nav layout doesn't
  // jump between SSR and hydration.
  const baseClasses = cn(
    'inline-flex size-8 items-center justify-center rounded-md border border-border bg-bg-subtle',
    'text-fg-muted transition-colors duration-fast',
    'hover:border-border-strong hover:text-fg',
    'focus-visible:outline-none focus-visible:shadow-ring',
  );

  if (!mounted) {
    return <span aria-hidden className={baseClasses} />;
  }

  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor;
  const label = labels[current];

  return (
    <button
      type="button"
      onClick={handleCycle}
      aria-label={label}
      title={label}
      className={baseClasses}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}

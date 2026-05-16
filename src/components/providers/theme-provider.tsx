'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ThemeProviderProps } from 'next-themes';

/**
 * Thin client-side wrapper around `next-themes`. Lives in /providers so
 * the locale layout can mount it next to AuthProvider.
 *
 * Wiring choices:
 *   - attribute="data-theme" matches @aster-cloud/tokens (its dark
 *     ramp is scoped to [data-theme="dark"]).
 *   - defaultTheme="system" honors prefers-color-scheme on first visit;
 *     once the user picks an explicit choice, the cookie sticks.
 *   - disableTransitionOnChange avoids a global transition flash when
 *     hundreds of tokenized colors flip at once.
 *   - enableSystem keeps the "system" option available in the toggle.
 *
 * Hooks like Monaco's `useTheme()` were already in the codebase but
 * orphaned (no provider). Mounting this finally resolves them.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}

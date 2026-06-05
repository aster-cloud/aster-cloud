'use client';

/**
 * Top nav for /docs/* — fixed, brand-left, switchers-right.
 *
 * Three render states (driven by `useDocsSession()`):
 *   - `probing`        → skeleton (square + thin line) so the layout
 *                        doesn't shift when the session probe resolves.
 *   - `anonymous`      → "Sign in" link + "Open Console" CTA → /login.
 *   - `authenticated`  → avatar button → dropdown (Dashboard /
 *                        Settings / Sign out). The avatar gradient is
 *                        seeded by `subjectHash`, a non-PII per-user
 *                        opaque token. No email, name, or tenant is
 *                        ever rendered.
 *
 * a11y:
 *   - The state container is `aria-live="polite"` so a screen reader
 *     announces the swap from probing → resolved without yelling.
 *   - The avatar button uses plain disclosure semantics
 *     (`aria-haspopup="true"` + `aria-expanded`), not the ARIA `menu`
 *     pattern. WCAG's APG endorses button-popup for small navigation
 *     dropdowns; implementing menu's roving focus contract for 3
 *     items is over-engineering.
 *   - Click-outside + Escape close the popup and return focus to the
 *     avatar button.
 *
 * Why no Radix DropdownMenu: matching dashboard-nav.tsx's lightweight
 * portal-free implementation keeps the bundle small and avoids a
 * second focus-trap library in the docs route.
 */

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Wordmark, cn } from '@aster-cloud/ui';
import { DocsLanguageSwitcher } from '@/components/docs/DocsLanguageSwitcher';
import { DocsTopNavSearchButton } from '@/components/docs/DocsTopNavSearchButton';
import { clearDocsSessionCache, useDocsSession } from '@/lib/docs/use-docs-session';

/**
 * Build a deterministic 2-color linear gradient from an 8-byte hex
 * `subjectHash`. Splits the hash into two 24-bit slices, derives the
 * first hue freely from slice A, then forces slice B's contribution
 * to live in a 60-180° offset window so the two colors always read
 * as a gradient rather than collapse to a flat tile.
 */
function gradientFromHash(hash: string): string {
  if (!hash || hash.length < 8) {
    return 'linear-gradient(135deg, hsl(220 12% 70%), hsl(220 12% 50%))';
  }
  const a = parseInt(hash.slice(0, 6), 16);
  const b = parseInt(hash.slice(8, 14) || hash.slice(2, 8), 16);
  const hue1 = a % 360;
  // Guarantee >= 60° hue separation. (b % 180) is in [0, 180) so the
  // gap is [60, 240), wrapping back into a recognizable second hue
  // regardless of how slice B falls.
  const hue2 = (hue1 + 60 + (b % 180)) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 65% 55%), hsl(${hue2} 60% 45%))`;
}

function NavRight() {
  const t = useTranslations();
  const session = useDocsSession();

  if (session.status === 'probing') {
    // Skeleton dimensions track the resolved anonymous state so the
    // resolution swap doesn't shift the right edge of the nav. The
    // outer wrapper width matches "Sign in" text-link + primary CTA
    // button in the German layout (worst case). `motion-reduce`
    // suppresses the pulse for vestibular sensitivity.
    return (
      <div
        className="flex items-center gap-2 sm:gap-4"
        aria-busy="true"
        aria-label={t('docs.session.probing')}
      >
        <div className="hidden sm:block h-5 w-14 rounded bg-bg-subtle animate-pulse motion-reduce:animate-none" />
        <div className="h-8 w-28 sm:w-32 rounded-md bg-bg-subtle animate-pulse motion-reduce:animate-none" />
      </div>
    );
  }

  if (session.status === 'authenticated') {
    return <AuthenticatedMenu subjectHash={session.subjectHash} />;
  }

  return (
    <div className="flex items-center gap-2 sm:gap-4">
      {/* Hide the bare "Sign in" link on narrow phones — DE's
          "Anmelden" + "Konsole öffnen" plus language switcher otherwise
          overflows the h-16 row at 320–375px. The CTA still leads
          anonymous users to /login. */}
      <Link
        href="/login"
        className={cn(
          'hidden sm:inline text-sm font-medium text-fg-muted transition-colors hover:text-fg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-md px-1',
        )}
      >
        {t('docs.nav.signIn')}
      </Link>
      <Link
        href="/login"
        className={cn(
          'inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg',
          'transition-colors hover:bg-primary-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        )}
      >
        {t('docs.nav.openConsole')}
      </Link>
    </div>
  );
}

function AuthenticatedMenu({ subjectHash }: { subjectHash: string }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Disclosure semantics (not ARIA `menu`). ARIA's menu pattern
  // requires arrow-key roving focus + Home/End + first-letter typeahead;
  // implementing that for a 3-item dropdown is over-engineering and
  // accessibility guidance (WCAG ARIA APG note) explicitly endorses
  // a plain button/popup for navigation menus. Tab moves through the
  // links naturally; Escape + click-outside close + focus-return.
  const closeAndReturnFocus = () => {
    setOpen(false);
    // Return focus to the trigger so SR/keyboard users keep their
    // place. Defer to next frame so React's state update settles
    // before the ref-based focus call.
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    function onPointer(ev: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        closeAndReturnFocus();
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') closeAndReturnFocus();
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    // Flip the cached docs state to anonymous immediately so any
    // other open docs tab updates via the storage event before the
    // signOut redirect lands.
    clearDocsSessionCache();
    await signOut({ callbackUrl: '/' });
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        ref={buttonRef}
        aria-label={t('docs.nav.userMenu.label')}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-8 w-8 rounded-full border border-border flex items-center justify-center text-white/85',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        )}
        style={{ background: gradientFromHash(subjectHash) }}
      >
        {/* Generic user glyph — recognizable without exposing an
            initial (initials are mild PII; we keep the docs probe
            response PII-free). */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="currentColor"
        >
          <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.31 0-8 1.79-8 5v1h16v-1c0-3.21-4.69-5-8-5z" />
        </svg>
      </button>
      {open && (
        <div
          className={cn(
            'absolute right-0 mt-2 w-48 rounded-md border border-border bg-bg shadow-lg py-1 z-50',
            'ring-1 ring-black/5 dark:ring-white/10',
          )}
        >
          <Link
            href="/dashboard"
            className="block px-4 py-2 text-sm text-fg hover:bg-bg-subtle"
            onClick={closeAndReturnFocus}
          >
            {t('docs.nav.userMenu.dashboard')}
          </Link>
          <Link
            href="/settings"
            className="block px-4 py-2 text-sm text-fg hover:bg-bg-subtle"
            onClick={closeAndReturnFocus}
          >
            {t('docs.nav.userMenu.settings')}
          </Link>
          <button
            type="button"
            disabled={signingOut}
            onClick={handleSignOut}
            className="block w-full text-left px-4 py-2 text-sm text-fg hover:bg-bg-subtle disabled:opacity-60"
          >
            {t('docs.nav.userMenu.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

export function DocsTopNav() {
  const t = useTranslations();
  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-20 h-16',
        'border-b border-border bg-bg/80 backdrop-blur-md',
      )}
    >
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          // 可访问名必须包含全部可见文字（WCAG 2.5.3）。可见内容是
          // Wordmark（role=img，名为 "Aster Cloud"）+ 后缀 "Docs"，
          // 因此 aria-label 取 "Aster Cloud Docs"，与可见文字一致；
          // 仅用 nav.brand 会漏掉可见的 "Docs"，触发 label mismatch。
          aria-label={`${t('nav.brand')} ${t('docs.nav.suffix')}`}
          className="flex items-center gap-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt=""
            aria-hidden
            className="h-8 w-8 shrink-0"
          />
          {/* Wordmark 自带 role=img + aria-label；后缀是装饰性视觉限定词。
              整体可见文字已由上面的 Link aria-label 覆盖，这里把视觉元素
              标 aria-hidden 避免重复进入可访问名树。 */}
          <span className="hidden sm:inline" aria-hidden="true">
            <Wordmark variant="product" size="md" />
          </span>
          <span className="ml-1 hidden text-sm font-medium text-fg-muted sm:inline" aria-hidden="true">
            {t('docs.nav.suffix')}
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-4" aria-live="polite">
          {/* Search sits to the LEFT of the language switcher so the
              chord pattern (label + ⌘K hint) reads naturally left-to-
              right next to the language code dropdown. */}
          <DocsTopNavSearchButton />
          <DocsLanguageSwitcher />
          <NavRight />
        </div>
      </div>
    </header>
  );
}

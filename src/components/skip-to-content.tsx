'use client';

import { useTranslations } from 'next-intl';

interface SkipToContentProps {
  /**
   * Fragment id of the main content target. REQUIRED to avoid silently
   * pointing at a non-existent fragment — dashboard uses `dashboard-main`
   * while public marketing pages use `main`, and no default would silently
   * break the other surface.
   */
  targetId: string;
}

/**
 * Keyboard-only "skip to main content" link. Visually hidden until
 * focused, then it slides in at top-left so Tab-from-document-start
 * lands here first and the user can jump past the header/sidebar.
 *
 * Lift / consolidate of the inline pattern previously copy-pasted in
 * src/app/[locale]/(dashboard)/layout.tsx.
 */
export function SkipToContent({ targetId }: SkipToContentProps) {
  const tCommon = useTranslations('common');
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg focus:shadow-lg"
    >
      {tCommon('skipToContent')}
    </a>
  );
}

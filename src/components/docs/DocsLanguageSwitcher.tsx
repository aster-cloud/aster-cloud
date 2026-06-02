'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { locales, localeNames, type Locale } from '@/i18n/config';

/**
 * Static language switcher for the public docs site.
 *
 * Why not reuse <LanguageSwitcher> from the landing page:
 *   - That component fetches available lexicons from the policy API
 *     (useAvailableLexicons). If the backend is unreachable the dropdown
 *     gets stuck in `disabled` state — unacceptable for documentation
 *     that must be navigable without backend dependencies.
 *   - Docs locales come from the static @/i18n/config tuple. The
 *     compiled set is the source of truth here; no runtime probe.
 *
 * Keystrokes + focus ring are tokenized for a11y; tab order is the
 * native <select> default.
 */
export function DocsLanguageSwitcher() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Locale;
    router.replace(pathname, { locale: next });
  }

  return (
    <select
      aria-label={t('docs.langSwitcher.ariaLabel')}
      value={locale}
      onChange={handleChange}
      className={
        'h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
        'focus-visible:ring-offset-2 focus-visible:ring-offset-bg cursor-pointer'
      }
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {localeNames[l]}
        </option>
      ))}
    </select>
  );
}

'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { locales, localeNames, type Locale } from '@/i18n/config';

// Set cookie for locale preference
function setLocaleCookie(locale: string) {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `NEXT_LOCALE=${locale}; expires=${expires}; path=/; SameSite=Lax`;
}

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleChange = (newLocale: string) => {
    // Update the NEXT_LOCALE cookie to reflect user's choice
    setLocaleCookie(newLocale);

    // Use next-intl's locale-aware router to navigate
    // The router.replace with locale option handles the path correctly
    router.replace(pathname, { locale: newLocale as Locale });
  };

  return (
    <select
      value={locale}
      onChange={(e) => handleChange(e.target.value)}
      className="bg-transparent border border-gray-300 rounded-md px-2 py-1 text-sm text-gray-600 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer"
    >
      {locales.map((loc) => (
        <option key={loc} value={loc}>
          {localeNames[loc as Locale]}
        </option>
      ))}
    </select>
  );
}

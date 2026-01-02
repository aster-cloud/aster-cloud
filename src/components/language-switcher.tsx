'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { locales, localeNames, type Locale } from '@/i18n/config';

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleChange = (newLocale: string) => {
    // Remove current locale prefix from pathname
    let newPathname = pathname;

    // Check if pathname starts with current locale
    for (const loc of locales) {
      if (pathname.startsWith(`/${loc}/`)) {
        newPathname = pathname.slice(loc.length + 1); // Remove /{locale}
        break;
      } else if (pathname === `/${loc}`) {
        newPathname = '/';
        break;
      }
    }

    // Ensure newPathname starts with /
    if (!newPathname.startsWith('/')) {
      newPathname = '/' + newPathname;
    }

    // Navigate to new locale
    if (newLocale === 'en') {
      // English is default, no prefix needed
      router.push(newPathname);
      router.refresh();
    } else {
      const targetPath = newPathname === '/' ? `/${newLocale}` : `/${newLocale}${newPathname}`;
      router.push(targetPath);
      router.refresh();
    }
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

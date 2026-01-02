export const locales = ['en', 'zh', 'de'] as const;
export const defaultLocale = 'en' as const;

// Whether to auto-detect locale from browser's Accept-Language header
// Set to true to automatically show the site in user's preferred language
// Set to false to always show the default locale unless user manually switches
export const localeDetection = false;

export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  de: 'Deutsch',
};

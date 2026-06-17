export const locales = ['en', 'zh', 'de', 'hi'] as const;
export const defaultLocale = 'en' as const;

/**
 * Locales whose message catalog is only PARTIALLY translated (GitHub #98).
 *
 * `hi` ships ~7% of the `en` backbone keys; the deep-merge fallback in
 * src/i18n/request.ts silently falls back to English for the rest, so it does
 * NOT crash — users just see mostly-English UI under a Hindi label.
 *
 * This is metadata only: `hi` is intentionally still listed in `locales` above
 * so existing behavior (and the deep-merge fallback) is unchanged. There is no
 * UI mechanism today to surface a "beta/partial" badge or to gate a partial
 * locale out of the switcher, and adding one is a PRODUCT decision (do we hide
 * it, badge it, or finish the translation?). Until product decides, this array
 * documents the gap and can be consumed by a future UI badge or a coverage gate.
 *
 * Coverage is reported by `pnpm check:locale-coverage` (scripts/check-locale-coverage.mjs).
 */
export const partialLocales: readonly Locale[] = ['hi'] as const;

// Whether to auto-detect locale from browser's Accept-Language header
// Set to true to automatically show the site in user's preferred language
// Set to false to always show the default locale unless user manually switches
export const localeDetection = false;

export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  zh: '中文',
  de: 'Deutsch',
  hi: 'हिन्दी',
};

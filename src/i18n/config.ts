export const locales = ['en', 'zh', 'de', 'hi'] as const;
export const defaultLocale = 'en' as const;

/**
 * Locales whose message catalog is only PARTIALLY translated (GitHub #98).
 *
 * 现在所有 locale（zh / de / hi）都已全量翻译（100% 覆盖 en backbone），
 * 因此此数组为空。`check:locales:strict`（CI）对全部 COMPARE locale 强制 key 对齐；
 * 部分翻译的 deep-merge fallback（src/i18n/request.ts）仍是兜底安全网，但不再有
 * 已知缺口。若未来新增一个尚未译完的 locale，把它列在这里以驱动「beta/partial」徽章。
 *
 * Coverage is reported by `pnpm check:locale-coverage` (scripts/check-locale-coverage.mjs).
 */
export const partialLocales: readonly Locale[] = [] as const;

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

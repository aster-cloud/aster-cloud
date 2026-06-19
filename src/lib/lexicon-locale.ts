/**
 * @module lib/lexicon-locale
 *
 * 把后端 lexicon 列表（/api/v1/lexicons，BCP-47 id 如 "hi-IN"）映射到 UI locale
 * 短码（如 "hi"）。供 LanguageSwitcher 与各语言设置卡片复用，避免重复实现。
 */

import { locales, type Locale } from '@/i18n/config';
import type { LexiconInfo } from '@/hooks/useAvailableLexicons';

/**
 * lexicon.id 是 BCP-47（"zh-CN"），UI locale 是短码（"zh"）。
 * 取首段并小写：en-US↔en, zh-CN↔zh, de-DE↔de, hi-IN↔hi。
 */
export function lexiconIdToUiLocale(lexId: string): string {
  return lexId.split('-')[0].toLowerCase();
}

/**
 * 后端当前可用的 UI locale 集（编译支持 ∩ 后端 lexicon）。
 * 后端尚未返回（lexicons 为空）时返回 null = "未知，不据此过滤"，由调用方决定兜底。
 */
export function backendAvailableLocales(lexicons: readonly LexiconInfo[]): Locale[] | null {
  if (lexicons.length === 0) return null;
  const backend = new Set(lexicons.map((l) => lexiconIdToUiLocale(l.id)));
  return locales.filter((l) => backend.has(l));
}

/**
 * UI 短码 → 后端 lexicon id（BCP-47）的**稳定**映射。
 *
 * 用于管理面板调 enable/disable：disable 某语种后其 id 会从 /api/v1/lexicons 消失，
 * 所以**不能**只从 live 列表派生反查表（否则无法再 enable 一个已 disable 的语种）。
 * 这四个是编译期固定语种，标签稳定，直接登记。
 *
 * 与 useAvailableLocales（dev/cloud）的 FULL_TO_SHORT 是同一组映射的反向；新增编译期
 * 语种时两处都要补（已被 LOCALE_LEXICON_ID 的 satisfies 完整性约束在本仓兜住）。
 */
export const LOCALE_LEXICON_ID = {
  en: 'en-US',
  zh: 'zh-CN',
  de: 'de-DE',
  hi: 'hi-IN',
} satisfies Record<Locale, string>;

/** 反查：把 UI 短码映回后端 lexicon id（BCP-47）。 */
export function uiLocaleToLexiconId(loc: Locale): string {
  return LOCALE_LEXICON_ID[loc];
}

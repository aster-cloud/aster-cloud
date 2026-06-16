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

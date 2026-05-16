'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { locales, localeNames, defaultLocale, type Locale } from '@/i18n/config';
import { useAvailableLexicons, type LexiconInfo } from '@/hooks/useAvailableLexicons';

// 写回 NEXT_LOCALE cookie，让 SSR 后续请求复用用户选择
function setLocaleCookie(locale: string) {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `NEXT_LOCALE=${locale}; expires=${expires}; path=/; SameSite=Lax`;
}

/**
 * Toast 信息要跨 router.replace 存活。
 *
 * router.replace 触发 Next.js 路由层重建 [locale] 段，LanguageSwitcher 整个
 * 重新挂载——纯 React state 会丢。用 sessionStorage 桥接：旧组件写入，
 * 新组件挂载时读取并立即清除。
 */
const TOAST_KEY = 'aster:lang-switcher:toast';

/**
 * lexicon.id 是 BCP-47（如 "zh-CN"），UI locale 是短码（如 "zh"）。
 * 这里做大小写不敏感的前缀匹配：lexicon.id 取首段（"zh-CN".split("-")[0] = "zh"），
 * 与 UI locale 比对。en-US ↔ en, zh-CN ↔ zh, de-DE ↔ de。
 */
function lexiconIdToUiLocale(lexId: string): string {
  return lexId.split('-')[0].toLowerCase();
}

/**
 * 计算"可用 UI 语言" = compiled-supported (locales) ∩ backend-available (lexicons)。
 * 永远至少包含 defaultLocale，避免下拉空白时无法切换。
 */
function intersect(lexicons: LexiconInfo[]): Locale[] {
  const backendSet = new Set(lexicons.map(l => lexiconIdToUiLocale(l.id)));
  const available = locales.filter(l => backendSet.has(l));
  if (available.length === 0) {
    // 后端尚未返回时退化为只显示 default，避免下拉闪烁成空
    return [defaultLocale];
  }
  return available as Locale[];
}

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('common');

  const { lexicons, loading } = useAvailableLexicons();
  const available = useMemo(() => intersect(lexicons), [lexicons]);

  // toast 状态：当前 locale 离开 available 集合时弹"已切回 English"提示。
  // 挂载时从 sessionStorage 回收上次离场前写入的 toast（跨 router.replace 桥接）。
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(TOAST_KEY);
      if (stored) {
        sessionStorage.removeItem(TOAST_KEY);
        setToast(stored);
      }
    } catch {
      // 隐私模式可能禁用 sessionStorage，忽略
    }
  }, []);

  // 当前 locale 不在 available 列表中（运维拔了对应语言包）→ 强制降级
  useEffect(() => {
    if (loading) return; // 等到 backend 返回才决断
    if (available.includes(locale as Locale)) return;
    // 真正的"语言失效"：通知用户并切到 defaultLocale
    const target = defaultLocale;
    const removedName = localeNames[locale as Locale] ?? locale;
    const message =
      t('languageUnavailable', { name: removedName }) +
      ' — ' +
      t('switchedTo', { name: localeNames[target] });

    // 写入 sessionStorage，新挂载的组件读取（router.replace 会导致重建）
    try {
      sessionStorage.setItem(TOAST_KEY, message);
    } catch {
      // 隐私模式：降级到 in-memory，至少本组件实例能看到
      setToast(message);
    }
    setLocaleCookie(target);
    router.replace(pathname, { locale: target });
  }, [available, loading, locale, pathname, router, t]);

  // toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const handleChange = (newLocale: string) => {
    setLocaleCookie(newLocale);
    router.replace(pathname, { locale: newLocale as Locale });
  };

  return (
    <>
      <select
        id="language-selector"
        name="language"
        aria-label={t('selectLanguage')}
        value={locale}
        onChange={(e) => handleChange(e.target.value)}
        disabled={loading}
        className="bg-transparent border border-border-strong rounded-md px-2 py-1 text-sm text-fg-muted hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent cursor-pointer disabled:opacity-50"
      >
        {available.map((loc) => (
          <option key={loc} value={loc}>
            {localeNames[loc]}
          </option>
        ))}
      </select>

      {toast && (
        // role="status" + aria-live="polite" 语义一致：alert 隐含 assertive，
        // 用在"友好降级提示"过于强烈；status + polite 让屏幕阅读器在闲时朗读
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 right-4 z-50 max-w-sm rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}

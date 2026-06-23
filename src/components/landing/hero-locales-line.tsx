'use client';

import { useMemo } from 'react';
import { useAvailableLexicons } from '@/hooks/useAvailableLexicons';
import { locales, localeNames, type Locale } from '@/i18n/config';

/**
 * Hero 标题里那行「可用语言」渐变文字（如 "English / 中文 / Deutsch / हिन्दी"）。
 *
 * 过去硬编码成 compiled 全集（i18n/config 的 `locales`），但管理员在后端禁用某语言后
 * 这行不会变——与 landing 语言切换器（已按 compiled∩backend 收敛）不一致。本组件让这行
 * **随后端可用语言动态变化**：
 *
 *   compiled（前端编译进的 locales） ∩ backend（/api/v1/lexicons 实时返回的语言包）
 *
 * 这是 dashboard 语言切换器同款交集口径（去掉团队白名单那一重——landing 无团队上下文）。
 *
 * ★fail-open★：landing 是公开营销页，后端探测失败/未返回时**退化为显示 compiled 全集**
 * （而非语言切换器那种退化到单一 default）——宁可多列一个暂不可用的语言，也不要让营销页
 * 看起来只支持一种语言。
 *
 * SSR/无 JS：服务端先用 `serverLabel`（compiled 全集）渲染，客户端 hydrate 后若探测到
 * 后端禁用了某语言，再收敛这行。首屏不闪空、不阻塞。
 */

// lexicon.id 是 BCP-47（"zh-CN"），UI locale 是短码（"zh"）。取首段小写比对。
// 与 language-switcher.tsx 的 lexiconIdToUiLocale 同口径。
function lexiconIdToUiLocale(lexId: string): string {
  return lexId.split('-')[0].toLowerCase();
}

/** 当前 locale 领头，其余按 compiled 顺序——与服务端 Hero 的排序一致。 */
function orderLocales(available: Locale[], locale: string): Locale[] {
  const set = new Set(available);
  const ordered = available.includes(locale as Locale)
    ? [locale as Locale, ...available.filter((l) => l !== locale)]
    : [...available];
  return ordered.filter((l) => set.has(l));
}

export function HeroLocalesLine({
  serverLabel,
  locale,
}: {
  /** 服务端预渲染的标签（compiled 全集 join），首屏 / 无 JS 直接用。 */
  serverLabel: string;
  /** 当前 UI locale，用于让用户母语领头。 */
  locale: string;
}) {
  const { lexicons, loading } = useAvailableLexicons();

  const label = useMemo(() => {
    // 未拿到后端响应前 → fail-open 用服务端全集标签（首屏不收敛、不闪烁）。
    if (loading || lexicons.length === 0) return serverLabel;

    const backendSet = new Set(lexicons.map((l) => lexiconIdToUiLocale(l.id)));
    const available = locales.filter((l) => backendSet.has(l));
    // 后端返回了但交集为空（异常）→ 同样 fail-open 回 compiled 全集。
    if (available.length === 0) return serverLabel;

    return orderLocales(available, locale)
      .map((l) => localeNames[l])
      .join(' / ');
  }, [lexicons, loading, serverLabel, locale]);

  return (
    <span className="block bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
      {label}
    </span>
  );
}

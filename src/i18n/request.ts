import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, locales, type Locale } from './config';
import { loadMessages } from './messages-loader';

/**
 * Deep-merge `override` 树到 `base` 之上。
 *
 * - 仅在 override 提供"非空字符串值或非空子树"时覆盖
 * - 返回新对象，不修改入参
 *
 * 用于 i18n fallback：把当前 locale 的消息树叠加到 en 之上。
 * 即便 zh/de 缺少某个 key，next-intl 也能查到 en 的对应值。
 */
type MessageTree = Record<string, unknown>;

/**
 * Exported for unit testing only. Production caller is the request handler below.
 */
export function deepMergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const result: MessageTree = { ...base };
  for (const key of Object.keys(override)) {
    const o = override[key];
    const b = result[key];
    if (
      o !== null &&
      typeof o === 'object' &&
      !Array.isArray(o) &&
      b !== null &&
      typeof b === 'object' &&
      !Array.isArray(b)
    ) {
      result[key] = deepMergeMessages(b as MessageTree, o as MessageTree);
    } else if (typeof o === 'string') {
      // R3-Sug：空串 / 全角空格 / tab-only 都视为"未翻译"，保留 base 的值。
      // 与 scripts/check-locales.ts 的 t.trim() === '' 判定一致
      if (o.trim().length > 0) result[key] = o;
    } else if (o !== undefined && o !== null) {
      // R4-FE-Minor：null 不能覆盖 base 的有效值
      result[key] = o;
    }
  }
  return result;
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !locales.includes(locale as Locale)) {
    locale = defaultLocale;
  }

  // 运行时加载（ADR 0018 Phase 2）：KV → 后端 /api/v1/messages → 内嵌兜底。
  // loadMessages 永远 fail-open 返回一个 MessageTree，绝不白屏。
  // 加载 fallback（永远是 en）作为底
  const fallbackMessages = await loadMessages(defaultLocale);

  // 当前 locale 的消息树叠加在上层；缺失的 key 自动落到 en
  const localeMessages =
    locale === defaultLocale
      ? fallbackMessages
      : await loadMessages(locale as Locale);

  const messages =
    locale === defaultLocale
      ? fallbackMessages
      : deepMergeMessages(fallbackMessages, localeMessages);

  return {
    locale,
    messages,
    // 缺失 key 兜底显示原始 key 路径，便于排查；运行时不抛
    getMessageFallback({ namespace, key }) {
      const path = namespace ? `${namespace}.${key}` : key;
      return path;
    },
    onError(error) {
      // 仅在非生产环境打印，避免污染服务器日志
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[i18n] ${error.code}: ${error.message}`);
      }
    },
  };
});

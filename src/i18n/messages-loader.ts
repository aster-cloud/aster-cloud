/**
 * @module i18n/messages-loader
 *
 * 统一语言包 Phase 2（ADR 0018）：界面文案的**运行时加载**。
 *
 * 取代 request.ts 里构建期的 `await import('../../messages/<locale>.json')`，改为：
 *
 *   Workers KV (CACHE, 版本化 key)  ──miss──▶  后端 /api/v1/messages/<full-id>
 *                                                        │
 *                                          任意环节失败 ▼
 *                                   内嵌 messages/<locale>.json（构建期 bundle）
 *
 * **铁律：fail-open**。fetch / KV / 解析任何一步失败，都 fallback 到内嵌 messages
 * （构建期仍打进 bundle，见 messages/ 目录），**绝不让用户看到白屏**。这是 hero
 * dashboard 崩溃教训的同款纪律：hot-path 必须降级到安全默认。
 *
 * 这样后端加一门语言（或改文案）→ 前端运行时 fetch 到新 messages → **无需重新
 * 构建部署**即可显示（前端热插拔贯通）。后端 messages 未发版时，内嵌副本兜底，
 * 行为与改造前完全一致。
 */

import { defaultLocale, type Locale } from './config';

/** cloud 短码 locale → 后端 lexicon 全码 id（/api/v1/messages 的主键）。 */
const LOCALE_ID_MAP: Record<Locale, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  de: 'de-DE',
  hi: 'hi-IN',
};

const API_BASE =
  process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL || 'https://policy.aster-lang.dev';

/** KV 缓存 TTL（秒）。版本化 key 已避免 stale，TTL 只是漏掉 reload 事件时的兜底上限。 */
const KV_TTL_SECONDS = 300;

type MessageTree = Record<string, unknown>;

/** KV 命名空间最小接口（与 lib/cache.ts 一致）。 */
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface CloudflareEnv {
  CACHE?: KVNamespace;
}

/** 取 Workers KV（非 Cloudflare 环境 / 本地 dev 返回 null → 直接回源，仍可用）。 */
async function getKV(): Promise<KVNamespace | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    return (context.env as CloudflareEnv)?.CACHE ?? null;
  } catch {
    return null;
  }
}

/**
 * 内嵌 messages（构建期 bundle）—— 最终兜底，永不失败。
 * 动态 import 保证按需加载、不把所有 locale 都拉进首屏。
 */
async function loadEmbedded(locale: Locale): Promise<MessageTree> {
  try {
    return (await import(`../../messages/${locale}.json`)).default as MessageTree;
  } catch {
    // 连内嵌都失败（理论上不该发生）→ 退到 en，再不行返回空对象（next-intl 用 key 兜底）。
    if (locale !== defaultLocale) {
      try {
        return (await import(`../../messages/${defaultLocale}.json`)).default as MessageTree;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

/**
 * 运行时获取某 locale 的界面文案：KV → 后端 → 内嵌兜底。
 *
 * @returns 永远返回一个 MessageTree（fail-open，不抛）。
 */
export async function loadMessages(locale: Locale): Promise<MessageTree> {
  const fullId = LOCALE_ID_MAP[locale];
  if (!fullId) {
    return loadEmbedded(locale);
  }

  const kv = await getKV();
  const kvKey = `ui-messages:${fullId}`;

  // 1) 查 KV
  if (kv) {
    try {
      const cached = await kv.get(kvKey);
      if (cached) {
        return JSON.parse(cached) as MessageTree;
      }
    } catch (error) {
      console.warn(`[i18n] KV read failed for ${fullId}:`, error);
    }
  }

  // 2) 回源后端 /api/v1/messages/<full-id>
  try {
    const res = await fetch(`${API_BASE}/api/v1/messages/${fullId}`, {
      // 后端 ETag 驱动版本；这里只要拿到 body 即可，缓存交给 KV。
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const text = await res.text();
      const tree = JSON.parse(text) as MessageTree;
      // 异步回填 KV（不阻塞响应）。
      if (kv) {
        kv.put(kvKey, text, { expirationTtl: KV_TTL_SECONDS }).catch((err) =>
          console.warn(`[i18n] KV write failed for ${fullId}:`, err)
        );
      }
      return tree;
    }
    // 404（locale 未启用 / 未加载）等 → 落入内嵌兜底。
    console.warn(`[i18n] backend messages ${fullId} → HTTP ${res.status}; using embedded`);
  } catch (error) {
    console.warn(`[i18n] backend messages fetch failed for ${fullId}; using embedded:`, error);
  }

  // 3) 兜底：内嵌（绝不白屏）
  return loadEmbedded(locale);
}

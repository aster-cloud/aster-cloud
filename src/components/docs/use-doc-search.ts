'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import type { SearchHit, SearchIndex } from '@/lib/docs/search-runtime';

/**
 * docs overlay 内的搜索 hook —— 复用现成的 search-index.<locale>.json + searchDocs
 * 纯函数运行时（与 docs 站的 DocsCommandPalette 同源），按需懒加载，去抖 120ms。
 *
 * hit.entry.slug 正是 overlay navigate(slug) 用的 slug，点结果即在 overlay 内切页。
 */

// 只装我们实际发布索引的 locale；其它（如 hi）回退 en。
const SUPPORTED = ['en', 'zh', 'de'] as const;
function resolveLocale(locale: string): (typeof SUPPORTED)[number] {
  return (SUPPORTED as readonly string[]).includes(locale)
    ? (locale as (typeof SUPPORTED)[number])
    : 'en';
}

const INDEX_CACHE: Record<string, SearchIndex | null> = {};
let runtimeMod: typeof import('@/lib/docs/search-runtime') | null = null;
let synonymsMod: typeof import('@/lib/docs/synonyms') | null = null;

async function loadIndex(locale: string): Promise<SearchIndex | null> {
  const safe = resolveLocale(locale);
  if (INDEX_CACHE[safe]) return INDEX_CACHE[safe];
  try {
    const mod = await import(`@/lib/docs/search-index.${safe}.json`);
    const index = (mod.default ?? mod) as SearchIndex;
    INDEX_CACHE[safe] = index;
    return index;
  } catch {
    return null;
  }
}

export function useDocSearch(query: string): { results: SearchHit[]; ready: boolean } {
  const locale = useLocale();
  const [results, setResults] = useState<SearchHit[]>([]);
  const [ready, setReady] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) {
      // query 变空时同步清空结果——从入参 query 派生的一次性清空，非渲染循环。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      const [index, runtime, synonyms] = await Promise.all([
        loadIndex(locale),
        (runtimeMod ??= await import('@/lib/docs/search-runtime')),
        (synonymsMod ??= await import('@/lib/docs/synonyms')),
      ]);
      if (cancelled || !index) {
        if (!cancelled) setResults([]);
        return;
      }
      const hits = runtime.searchDocs(q, index, {
        synonyms: synonyms.synonymsFor(locale),
        limit: 8,
      });
      if (!cancelled) {
        setResults(hits);
        setReady(true);
      }
    }, 120);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, locale]);

  return { results, ready };
}

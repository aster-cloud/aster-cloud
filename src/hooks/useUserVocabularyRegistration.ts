/**
 * useUserVocabularyRegistration — 把当前用户的自定义领域词汇注入 aster-lang-ts
 * 引擎的 vocabularyRegistry（per-tenant custom 词汇），让编译/翻译层（而非
 * 仅高亮层）也能识别用户自定义术语。
 *
 * 背景（ADR 0014 线B）：引擎与 registry 早已支持 `registerCustom(tenantId,
 * vocab)`，但 aster-cloud 从未调用它——用户在 DB 里定义的术语只进了高亮路径，
 * 编译时 `canonicalize({domain})` 走 builtin-only 查找，翻不了用户词。本 hook
 * 补上这根线：
 *   1. 拉取用户在 (domain, locale) 下的活跃词汇链接（复用既有 GET API）。
 *   2. 组装成 DomainVocabulary（纯叶子 assemble 模块，与服务端同源）。
 *   3. `vocabularyRegistry.registerCustom(tenantId, vocab)` 注入引擎。
 *   4. 订阅词汇 SSE 失效 tick，用户增删词后自动重新注册。
 *
 * 返回组装后的 vocabulary（也可喂给 Monaco 高亮，让用户词与编译翻译同源），
 * 以及一个随注册变化递增的 epoch，供下游 effect 触发重编译/重高亮。
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  vocabularyRegistry,
  initBuiltinVocabularies,
  type DomainVocabulary,
} from '@/lib/aster-lexicon';
import {
  assembleDomainVocabularyFromLinks,
  type TermLikeRow,
} from '@/lib/domain-vocabulary-assemble';
import { useDomainVocabularyInvalidate } from '@/hooks/useDomainVocabularyInvalidate';

/** GET /api/v1/domain-vocabularies/terms 返回的单条链接（取用到的字段）。 */
interface TermLink {
  domainTermId?: string;
  termId?: string;
  domain: string;
  locale: string;
  kind: string;
  canonical: string;
  localized: string;
  parentCanonical?: string | null;
  aliases?: readonly string[] | null;
  description?: string | null;
}

interface ListResponse {
  items?: TermLink[];
}

export interface UseUserVocabularyRegistrationOptions {
  /** 租户标识符；缺省（匿名/未登录）时跳过注册。 */
  tenantId?: string;
  /** 领域标识符。 */
  domain?: string;
  /** 语言代码（如 'en-US'）。 */
  locale: string;
  /** 关闭注册（例如 feature flag 或匿名会话）。 */
  enabled?: boolean;
}

export interface UseUserVocabularyRegistrationResult {
  /** 组装后的用户词汇（无词汇时为 undefined）。 */
  vocabulary: DomainVocabulary | undefined;
  /** 每次成功重新注册递增，供下游 effect 依赖。 */
  epoch: number;
}

/** 把 API 行映射成 assemble 所需的最小行结构。 */
function toTermLikeRow(link: TermLink): TermLikeRow {
  return {
    domainTermId: link.domainTermId ?? link.termId ?? '',
    domain: link.domain,
    locale: link.locale,
    kind: link.kind,
    canonical: link.canonical,
    localized: link.localized,
    parentCanonical: link.parentCanonical ?? undefined,
    aliases: link.aliases ?? undefined,
    description: link.description ?? undefined,
  };
}

export function useUserVocabularyRegistration({
  tenantId,
  domain,
  locale,
  enabled = true,
}: UseUserVocabularyRegistrationOptions): UseUserVocabularyRegistrationResult {
  const [vocabulary, setVocabulary] = useState<DomainVocabulary | undefined>(undefined);
  const [epoch, setEpoch] = useState(0);

  const active = Boolean(enabled && tenantId && domain);

  // 用户增删词后服务端推 invalidate，tick 递增触发重新拉取 + 注册。
  const vocabTick = useDomainVocabularyInvalidate({
    enabled: active,
    match: domain ? { domain, locale } : undefined,
  });

  useEffect(() => {
    if (!active || !tenantId || !domain) return;
    let cancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams({ domain, locale, pageSize: '500' });
        const res = await fetch(`/api/v1/domain-vocabularies/terms?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = (await res.json()) as ListResponse;
        const items = data.items ?? [];
        if (cancelled) return;

        // 引擎查找以内置词汇为兜底，先确保内置已初始化。
        initBuiltinVocabularies();

        if (items.length === 0) {
          // 用户清空了该领域词汇：撤销自定义注册，回退到 builtin。
          // unregisterCustom 在引擎新版本才有；vendored tarball 尚未含此方法时
          // 以可选方式安全降级（不撤销，旧注册随注册新词或刷新自然失效）。
          const registry = vocabularyRegistry as {
            unregisterCustom?: (tenantId: string, domain: string, locale: string) => boolean;
          };
          registry.unregisterCustom?.(tenantId, domain, locale);
          setVocabulary(undefined);
          setEpoch((n) => n + 1);
          return;
        }

        const vocab = assembleDomainVocabularyFromLinks(items.map(toTermLikeRow), {
          domain,
          locale,
        });
        vocabularyRegistry.registerCustom(tenantId, vocab);
        setVocabulary(vocab);
        setEpoch((n) => n + 1);
      } catch {
        // 网络/解析失败：保持上一次注册，不影响编辑器可用性。
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [active, tenantId, domain, locale, vocabTick]);

  return useMemo(() => ({ vocabulary, epoch }), [vocabulary, epoch]);
}

/**
 * Aster Lang 词法适配层
 *
 * 从 @aster-cloud/aster-lang-ts 导入词法定义，
 * 提供 aster-cloud 所需的简化接口和 Monaco 关键词提取功能。
 */

import type { Lexicon } from '@aster-cloud/aster-lang-ts/lexicons/types';
import type { DomainVocabulary, IdentifierIndex } from '@aster-cloud/aster-lang-ts/lexicons/identifiers/types';
import { EN_US } from '@aster-cloud/aster-lang-ts/lexicons/en-US';
import { ZH_CN } from '@aster-cloud/aster-lang-ts/lexicons/zh-CN';
import { DE_DE } from '@aster-cloud/aster-lang-ts/lexicons/de-DE';
import { SemanticTokenKind } from '@aster-cloud/aster-lang-ts/token-kind';
import {
  vocabularyRegistry,
  initBuiltinVocabularies,
} from '@aster-cloud/aster-lang-ts/lexicons/identifiers/registry';
import { buildIdentifierIndex } from '@aster-cloud/aster-lang-ts/lexicons/identifiers/types';

export type { Lexicon, DomainVocabulary, IdentifierIndex };
export { EN_US, ZH_CN, DE_DE, SemanticTokenKind };
export { vocabularyRegistry, initBuiltinVocabularies, buildIdentifierIndex };

// LSP UI 本地化文本将在 aster-lang-ts 下一版本发布后从包导入
// 目前使用内联常量替代

/**
 * 根据 locale 获取词法配置。
 */
export function getLexicon(locale: string): Lexicon {
  if (locale === 'zh' || locale === 'zh-CN') return ZH_CN;
  if (locale === 'de' || locale === 'de-DE') return DE_DE;
  return EN_US;
}

/**
 * 从词法表提取所有单词（用于 Monaco Monarch 语法高亮）。
 *
 * 将多词关键词拆分为单词，便于 Monarch tokenizer 逐词匹配。
 */
export function extractMonarchKeywords(lexicon: Lexicon): string[] {
  const words = new Set<string>();
  for (const value of Object.values(lexicon.keywords)) {
    for (const word of String(value).split(/\s+/)) {
      if (word) words.add(word);
    }
  }
  return [...words];
}

/**
 * 获取指定领域+语言的词汇表。
 */
export function getVocabulary(domain: string, locale: string): DomainVocabulary | undefined {
  return vocabularyRegistry.get(domain, locale)?.vocabulary;
}

/**
 * 从词汇表提取所有本地化术语（用于 Monaco Monarch 高亮）。
 */
export function extractVocabularyTerms(vocabulary: DomainVocabulary): string[] {
  const terms = new Set<string>();

  for (const m of vocabulary.structs) {
    terms.add(m.localized);
    m.aliases?.forEach(a => terms.add(a));
  }
  for (const m of vocabulary.fields) {
    terms.add(m.localized);
    m.aliases?.forEach(a => terms.add(a));
  }
  for (const m of vocabulary.functions) {
    terms.add(m.localized);
    m.aliases?.forEach(a => terms.add(a));
  }
  for (const m of vocabulary.enumValues ?? []) {
    terms.add(m.localized);
    m.aliases?.forEach(a => terms.add(a));
  }

  return [...terms];
}

/**
 * 从词法表提取原语类型关键词（Text/Int/Float/Bool）和类型构造关键词
 * （Maybe/Option of/Result of）的本地化形式。用于 Monaco Monarch 的
 * typeKeywords，避免在 monaco-aster.ts 里硬编码多语言类型字面量。
 *
 * 注意：仅返回 lang-ts SemanticTokenKind 已定义的类型 token；Decimal、
 * Money、Date 等扩展类型仍由 monaco-aster 的 EXTRA_TYPE_KEYWORDS 提供，
 * 等 lang-ts 把它们加进 token-kind 后即可下沉到这里。
 */
export function extractPrimitiveTypeKeywords(lexicon: Lexicon): string[] {
  const out = new Set<string>();
  // Type tokens recognised by the lang-ts type-parser as type constructors.
  // R-fix 9 codex finding: Maybe/Option of/Result of were rendering as
  // plain keywords. They're semantically type-level and should highlight
  // as 'type' across all three locales.
  const typeKinds = [
    // primitive types
    SemanticTokenKind.TEXT,
    SemanticTokenKind.INT_TYPE,
    SemanticTokenKind.FLOAT_TYPE,
    SemanticTokenKind.BOOL_TYPE,
    // type constructors
    SemanticTokenKind.MAYBE,
    SemanticTokenKind.OPTION_OF,
    SemanticTokenKind.RESULT_OF,
  ];
  for (const kind of typeKinds) {
    const value = lexicon.keywords[kind];
    if (typeof value === 'string' && value) out.add(value);
  }
  return [...out];
}

/**
 * 跨多个词法表提取所有原语类型关键词的并集。Monaco Monarch 在加载时
 * 需要同时识别 EN/ZH/DE 三套类型字面量（因为同一文档可能含多语言注释）。
 */
export function extractPrimitiveTypeKeywordsAll(lexicons: readonly Lexicon[]): string[] {
  const out = new Set<string>();
  for (const lex of lexicons) {
    for (const kw of extractPrimitiveTypeKeywords(lex)) out.add(kw);
  }
  return [...out];
}

/**
 * 按类别获取关键词（用于 Monaco 分类着色）。
 */
export function getKeywordsByCategory(lexicon: Lexicon) {
  const kw = lexicon.keywords;
  return {
    module: [
      kw[SemanticTokenKind.MODULE_DECL],
      kw[SemanticTokenKind.IMPORT],
      kw[SemanticTokenKind.IMPORT_ALIAS],
    ],
    type: [
      kw[SemanticTokenKind.TYPE_DEF],
      kw[SemanticTokenKind.TYPE_WITH],
      kw[SemanticTokenKind.TYPE_HAS],
      kw[SemanticTokenKind.TYPE_ONE_OF],
    ],
    function: [
      kw[SemanticTokenKind.FUNC_TO],
      kw[SemanticTokenKind.FUNC_GIVEN],
      kw[SemanticTokenKind.FUNC_PRODUCE],
      kw[SemanticTokenKind.FUNC_PERFORMS],
    ],
    control: [
      kw[SemanticTokenKind.IF],
      kw[SemanticTokenKind.OTHERWISE],
      kw[SemanticTokenKind.MATCH],
      kw[SemanticTokenKind.WHEN],
      kw[SemanticTokenKind.RETURN],
      kw[SemanticTokenKind.RESULT_IS],
      kw[SemanticTokenKind.FOR_EACH],
      kw[SemanticTokenKind.IN],
    ],
    variable: [
      kw[SemanticTokenKind.LET],
      kw[SemanticTokenKind.BE],
      kw[SemanticTokenKind.SET],
      kw[SemanticTokenKind.TO_WORD],
    ],
    boolean: [
      kw[SemanticTokenKind.OR],
      kw[SemanticTokenKind.AND],
      kw[SemanticTokenKind.NOT],
    ],
    operator: [
      kw[SemanticTokenKind.PLUS],
      kw[SemanticTokenKind.MINUS_WORD],
      kw[SemanticTokenKind.TIMES],
      kw[SemanticTokenKind.DIVIDED_BY],
      kw[SemanticTokenKind.LESS_THAN],
      kw[SemanticTokenKind.GREATER_THAN],
      kw[SemanticTokenKind.EQUALS_TO],
      kw[SemanticTokenKind.IS],
      kw[SemanticTokenKind.UNDER],
      kw[SemanticTokenKind.OVER],
      kw[SemanticTokenKind.MORE_THAN],
    ],
    literal: [
      kw[SemanticTokenKind.TRUE],
      kw[SemanticTokenKind.FALSE],
      kw[SemanticTokenKind.NULL],
      kw[SemanticTokenKind.NONE],
    ],
    primitiveType: [
      kw[SemanticTokenKind.TEXT],
      kw[SemanticTokenKind.INT_TYPE],
      kw[SemanticTokenKind.FLOAT_TYPE],
      kw[SemanticTokenKind.BOOL_TYPE],
    ],
    workflow: [
      kw[SemanticTokenKind.WORKFLOW],
      kw[SemanticTokenKind.STEP],
      kw[SemanticTokenKind.DEPENDS],
      kw[SemanticTokenKind.ON],
      kw[SemanticTokenKind.COMPENSATE],
      kw[SemanticTokenKind.RETRY],
      kw[SemanticTokenKind.TIMEOUT],
      kw[SemanticTokenKind.MAX_ATTEMPTS],
      kw[SemanticTokenKind.BACKOFF],
    ],
    async: [
      kw[SemanticTokenKind.WITHIN],
      kw[SemanticTokenKind.SCOPE],
      kw[SemanticTokenKind.START],
      kw[SemanticTokenKind.ASYNC],
      kw[SemanticTokenKind.AWAIT],
      kw[SemanticTokenKind.WAIT_FOR],
    ],
    constraint: [
      kw[SemanticTokenKind.REQUIRED],
      kw[SemanticTokenKind.BETWEEN],
      kw[SemanticTokenKind.AT_LEAST],
      kw[SemanticTokenKind.AT_MOST],
      kw[SemanticTokenKind.MATCHING],
      kw[SemanticTokenKind.PATTERN],
    ],
  };
}

/**
 * Aster Lang 词法适配层
 *
 * 从 @aster-cloud/aster-lang-ts 导入词法定义，
 * 提供 aster-cloud 所需的简化接口和 Monaco 关键词提取功能。
 */

import type { Lexicon } from '@aster-cloud/aster-lang-ts/lexicons/types';
import { EN_US } from '@aster-cloud/aster-lang-ts/lexicons/en-US';
import { ZH_CN } from '@aster-cloud/aster-lang-ts/lexicons/zh-CN';
import { DE_DE } from '@aster-cloud/aster-lang-ts/lexicons/de-DE';
import { SemanticTokenKind } from '@aster-cloud/aster-lang-ts/token-kind';

export type { Lexicon };
export { EN_US, ZH_CN, DE_DE, SemanticTokenKind };

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

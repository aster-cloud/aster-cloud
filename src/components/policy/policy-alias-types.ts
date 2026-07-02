/**
 * 关键词别名 UI 的 kind 元数据（ADR 0022，Phase A）。
 *
 * <p>只列 server 白名单允许用户自定义的 11 个**低风险运算符/比较词**（与
 * policy-alias-shared.ALLOWED_KINDS 对齐）。结构词（Module/Rule/If/Return）被红队 H3 故意禁止
 * 用户别名（防误导审批），不在此列。
 *
 * <p>面板按「算术」「比较」两组展示，每 kind 显示其在当前 lexicon 的规范拼写 + 用户多词别名输入。
 */
import type { SemanticTokenKind } from '@aster-cloud/aster-lang-ts/token-kind';

/** 别名 kind 分组。 */
export type AliasKindGroup = 'arithmetic' | 'comparison';

export interface AliasKindMeta {
  /** SemanticTokenKind 名（进 aliasSet 的 key，与 server ALLOWED_KINDS 一致）。 */
  readonly kind: string;
  /** 分组（UI 折叠/分区）。 */
  readonly group: AliasKindGroup;
  /** 数学符号（UI 辅助显示，非功能性）。 */
  readonly symbol: string;
  /** i18n 短标签 key（在 policies.form.aliases.kinds.* 下）。 */
  readonly labelKey: string;
}

/**
 * 11 个可别名 kind（顺序即 UI 展示顺序）。kind 名与 policy-alias-shared.ALLOWED_KINDS 逐一对应。
 */
export const USER_ALIAS_KINDS: readonly AliasKindMeta[] = [
  { kind: 'PLUS', group: 'arithmetic', symbol: '+', labelKey: 'plus' },
  { kind: 'MINUS_WORD', group: 'arithmetic', symbol: '−', labelKey: 'minus' },
  { kind: 'TIMES', group: 'arithmetic', symbol: '×', labelKey: 'times' },
  { kind: 'DIVIDED_BY', group: 'arithmetic', symbol: '÷', labelKey: 'dividedBy' },
  { kind: 'INTEGER_DIVIDED_BY', group: 'arithmetic', symbol: '÷ᵢ', labelKey: 'integerDividedBy' },
  { kind: 'MODULO', group: 'arithmetic', symbol: 'mod', labelKey: 'modulo' },
  { kind: 'LESS_THAN', group: 'comparison', symbol: '<', labelKey: 'lessThan' },
  { kind: 'GREATER_THAN', group: 'comparison', symbol: '>', labelKey: 'greaterThan' },
  { kind: 'EQUALS_TO', group: 'comparison', symbol: '=', labelKey: 'equalsTo' },
  { kind: 'AT_LEAST', group: 'comparison', symbol: '≥', labelKey: 'atLeast' },
  { kind: 'AT_MOST', group: 'comparison', symbol: '≤', labelKey: 'atMost' },
] as const;

/** kind → SemanticTokenKind（用于从 lexicon.keywords 取该 kind 的规范拼写）。 */
export function kindToSemanticToken(kind: string): SemanticTokenKind {
  return kind as unknown as SemanticTokenKind;
}

/** 分组顺序（UI 分区渲染）。 */
export const ALIAS_KIND_GROUPS: readonly { group: AliasKindGroup; labelKey: string }[] = [
  { group: 'arithmetic', labelKey: 'groupArithmetic' },
  { group: 'comparison', labelKey: 'groupComparison' },
];

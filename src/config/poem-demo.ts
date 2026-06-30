/**
 * 「源码即诗」demo 配置（公开）
 *
 * 展示 Aster 关键词别名机制（ADR 0022）+ 无括号单参调用（ADR 0027）的极致：一段 `.aster`
 * 源码**本身读起来就是一首诗**，却仍由生产同款浏览器引擎逐字编译、递归执行。别名只在
 * canonicalize 阶段归一回规范关键词——Lexer/Parser/Core IR 完全不知别名存在，故「诗体源码」
 * 与「规范关键词版」编译到结构一致的 Core IR。客户端纯静态 + 浏览器内 TS 引擎，即时可验。
 *
 * 与 aster-lang-ts/examples/alias-poem-story/bard.mjs 的 NIGHTFALL_EN 同源。
 */
import { EN_US } from '@aster-cloud/aster-lang-ts/browser';
import type { Lexicon } from '@aster-cloud/aster-lang-ts/browser';

/** SemanticTokenKind 字面量（避免对内部枚举的运行时依赖；值与 token-kind.ts 对齐）。 */
const K = {
  MODULE_DECL: 'MODULE_DECL',
  FUNC_TO: 'FUNC_TO',
  FUNC_GIVEN: 'FUNC_GIVEN',
  IF: 'IF',
  RETURN: 'RETURN',
  LET: 'LET',
  BE: 'BE',
  PLUS: 'PLUS',
  MINUS_WORD: 'MINUS_WORD',
  AT_MOST: 'AT_MOST',
  APPLY: 'APPLY',
} as const;

/**
 * NIGHTFALL（English）方言：在 en-US 上叠加吟游别名，规范拼写不动。每个别名都让源码某一行
 * 读作诗句：Module→Nightfall  Rule→I  given→count  If→while  Return→sing  Let→let  be→be
 * plus→with（字符串拼接）  minus→less  at most→but  apply→echoing（无括号递归调用，ADR 0027）。
 */
export const NIGHTFALL_EN: Lexicon = {
  ...EN_US,
  id: 'nightfall-en',
  name: 'Nightfall (English)',
  aliases: {
    [K.MODULE_DECL]: ['Nightfall'],
    [K.FUNC_TO]: ['I'],
    [K.FUNC_GIVEN]: ['count'],
    [K.IF]: ['while'],
    [K.RETURN]: ['sing'],
    [K.LET]: ['let'],
    [K.BE]: ['be'],
    [K.PLUS]: ['with'],
    [K.MINUS_WORD]: ['less'],
    [K.AT_MOST]: ['but'],
    // ADR 0027：无括号单参调用引入词，别名成诗词 echoing（递归=回响），藏掉最后一处括号。
    [K.APPLY]: ['echoing'],
  },
} as Lexicon;

/**
 * 诗体源码——逐行读是一首谣曲，逐 token 编译是一个递归函数 gather(stars)：把 n 颗星的光
 * 一句一句聚拢。最后一处「程序痕」（递归调用的括号）已由 `echoing gather to stars less 1`
 * 藏掉（apply 形，ADR 0027）。
 */
export const NIGHTFALL_SOURCE = `Nightfall comes.

I gather count stars:
  while stars but 1
    sing "and one last light to keep the dark from me".
  let earlier be echoing gather to stars less 1.
  sing earlier with " and one more light to set the evening free".`;

/** 入口 verse 名（规范名；别名只在表层）。 */
export const NIGHTFALL_ENTRY = 'gather';
/** 入参名。 */
export const NIGHTFALL_PARAM = 'stars';

/** 规范关键词版——证明诗体方言版 ≡ 规范版（结构一致 Core IR）的对照（CI 不变式）。 */
export const NIGHTFALL_CANONICAL = `Module comes.

Rule gather given stars:
  If stars at most 1
    Return "and one last light to keep the dark from me".
  Let earlier be apply gather to stars minus 1.
  Return earlier + " and one more light to set the evening free".`;

/** 可运行的「星数」案例：每个把 n 颗星的光聚成一句诗，递归一句句相续。 */
export interface PoemCase {
  /** 星数（入参）。 */
  stars: number;
  /** 预期吟诵结果（逐句拼接，gather 递归而成）。 */
  expect: string;
}

const LAST = 'and one last light to keep the dark from me';
const MORE = ' and one more light to set the evening free';

/** 续句标记（gather 递归每多一颗星追加一句）。UI 按它把吟诵结果切回逐行展示。 */
export const NIGHTFALL_MORE_MARKER = ' and one more light';

/** stars=n → LAST + MORE*(n-1)。与引擎执行结果逐字一致（CI 锁定）。 */
function recite(stars: number): string {
  let out = LAST;
  for (let i = 2; i <= stars; i++) out += MORE;
  return out;
}

/** 把吟诵结果按续句标记切回逐句诗行（与 recite 同源，UI 不再硬编码诗句片段）。 */
export function reciteLines(value: string): string[] {
  return value
    .split(new RegExp(`(?=${NIGHTFALL_MORE_MARKER})`))
    .map((s) => s.trim())
    .filter(Boolean);
}

export const NIGHTFALL_CASES: PoemCase[] = [1, 2, 3].map((stars) => ({
  stars,
  expect: recite(stars),
}));

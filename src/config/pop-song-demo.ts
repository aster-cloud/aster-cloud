/**
 * 「流行歌曲即源码」demo 配置(中文 zh 专属)——周杰伦《以父之名》(黄俊郎/周杰伦 作词)。
 *
 * 范式 = **源码即歌 + 字面量宏**(同静夜思 alias-literal):一段《以父之名》的**真实歌词
 * 逐字不改**,由生产同款浏览器 TS 引擎逐字真编译、真求值。关键词别名(ADR 0022)把每句歌词
 * 的领字变结构关键词,字面量宏(IdentifierKind.LITERAL)把末词展开成整句主题句;运行入口
 * 规则输出这句歌词。
 *
 * ★不改变歌词内容:源码里的歌词字**一个都没动**——「仁慈的父 我已坠入 / 看不见 罪的国度 /
 *   请原谅我 的自负」皆为《以父之名》原词。别名/字面量宏都只在 canonicalize 表层,
 *   Lexer/Parser/Core IR 不知歌词存在。
 *
 * ★诚实契约(已用生产引擎实证,见 pop-song-demo.compile.test.ts):
 *  1. 歌词体源码用《以父之名》别名词典 + 字面量宏词汇编译成功(无诊断错误)。
 *  2. 歌词体版 ≡ 规范关键词版(剥 origin 后结构一致 Core IR)——别名/宏只在表层。
 *  3. 字面量宏真实生效:源码含触发词「自负」但不含展开内容,规范版含展开内容,运行输出=宏内容。
 *  4. 入口规则运行恒输出主题句(宏展开,与入参无关;入口规则无参)。
 *
 * 别名:仁慈的父→模块 / 看不见→规则 / 请原谅我→产出(produce)/ 我低头→返回。
 * 字面量宏:自负 → 「仁慈的父，我已坠入看不见罪的国度」。
 */
import { ZH_CN, IdentifierKind } from '@aster-cloud/aster-lang-ts/browser';
import type { Lexicon, DomainVocabulary } from '@aster-cloud/aster-lang-ts/browser';

/** SemanticTokenKind 字面量(与 token-kind.ts 对齐,避免运行时依赖内部枚举)。 */
const K = {
  MODULE_DECL: 'MODULE_DECL',
  FUNC_TO: 'FUNC_TO',
  FUNC_PRODUCE: 'FUNC_PRODUCE',
  RETURN: 'RETURN',
} as const;

/** 「以父之名」demo 的完整配置(alias-literal 范式)。 */
export interface PopSongConfig {
  /** 标题(展示)。 */
  title: string;
  /** 题解(展示)。 */
  attribution: string;
  /** 叠加《以父之名》别名的 Lexicon。 */
  lexicon: Lexicon;
  /** 字面量宏词汇表(IdentifierKind.LITERAL):触发词 → 展开主题句。 */
  vocab: DomainVocabulary;
  /** 歌词体源码(真实歌词逐字不改)。 */
  source: string;
  /** 规范关键词版(证明歌词体 ≡ 规范版,结构一致 Core IR)。 */
  canonical: string;
  /** 入口 rule 名(规范名;歌词体与规范版共用)。 */
  entry: string;
  /** 字面量宏触发词(展示用:证明源码含它、但展开内容不在源码里)。 */
  macroTrigger: string;
  /** 运行输出的主题句(= evaluate 结果,CI 锁定)。 */
  output: string;
}

const YFZM_ZH = 'yfzm-zh';
const YFZM_OUTPUT = '仁慈的父，我已坠入看不见罪的国度';

/**
 * 《以父之名》真实歌词逐字即源码:
 *   仁慈的父 我已坠入
 *   看不见 罪的国度
 *   请原谅我 的自负
 * 领字经别名变结构关键词,末词「自负」经字面量宏展开成整句主题句;运行入口规则输出该句。
 */
export const POP_SONG: PopSongConfig = {
  title: '以父之名 · 歌词即源码',
  attribution: '周杰伦《以父之名》(黄俊郎/周杰伦 作词) · 真实歌词逐字即源码,运行输出主题名句',
  lexicon: {
    ...ZH_CN,
    id: YFZM_ZH,
    name: '以父之名(中文)',
    aliases: {
      [K.MODULE_DECL]: ['仁慈的父'], // 「仁慈的父 我已坠入」→ 模块 我已坠入
      [K.FUNC_TO]: ['看不见'], // 「看不见 罪的国度」→ 规则 罪的国度
      [K.FUNC_PRODUCE]: ['请原谅我'], // 「请原谅我 的自负」→ 产出(块起始)
      [K.RETURN]: ['我低头'], // 「我低头……」→ 返回
    },
  } as Lexicon,
  // 字面量宏:自负 → 主题句。vocab.locale 须 = lexicon.id(compile 用 lexicon.id 查词汇)。
  vocab: {
    id: YFZM_ZH,
    name: '以父之名',
    locale: YFZM_ZH,
    version: '1.0.0',
    structs: [],
    fields: [],
    functions: [],
    enumValues: [],
    literals: [{ localized: '自负', canonical: YFZM_OUTPUT, kind: IdentifierKind.LITERAL }],
  },
  source: `仁慈的父 我已坠入。
看不见 罪的国度 请原谅我 的自负:
  我低头 自负。`,
  canonical: `模块 我已坠入。
规则 罪的国度 产出 的自负:
  返回 「${YFZM_OUTPUT}」。`,
  entry: '罪的国度',
  macroTrigger: '自负',
  output: YFZM_OUTPUT,
};

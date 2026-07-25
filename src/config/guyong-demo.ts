/**
 * 「原创歌词即源码」demo 配置（中文 zh 专属）——《孤勇》(原创词/曲：本项目原创，非任何既有歌曲)。
 *
 * 范式 = **decision（裁决规则）+ LayoutMap（显示/编译解耦）**：一段**原创**叙事体歌词按词序即
 * 源码，关键词别名把每句领字变结构关键词，三个「信物」当字符串入参，引擎用「等于」比较逐一确定
 * 真值、再 并且 合成，最后 如果/否则 真判定输出裁决——翻任一信物裁决即变，是引擎**真推导**，非回声。
 *
 * ★歌词原创声明：全部歌词为本项目原创，不取自任何既有歌曲；主题「孤勇与救赎」。
 *
 * ★LayoutMap：页面**显示** toDisplay（无关键词空格、读成流动歌词），引擎**编译** toCanonical
 *   （语法必需的带空格规范源码）。不变式：toCanonical(GUYONG_LAYOUT) === source。
 *
 * ★诚实契约（已用生产同款 TS 引擎实证，见 guyong-demo.compile.test.ts）：
 *  1. 歌词体源码用《孤勇》别名词典编译成功（无诊断错误）。
 *  2. 歌词体版 ≡ 规范关键词版（剥 origin 后结构一致 Core IR）——别名只在 canonicalize 表层。
 *  3. LayoutMap 不变式：toCanonical(layout) 逐字 === source；toDisplay 无关键词空格且保留全部内容。
 *  4. 裁决真推导：三信物全匹配 → 「归途」；翻任一 → 「坠落」（引擎真判定，翻转随信物）。
 *
 * 别名：孤身→模块 / 我问→规则 / 凭→给定 / 我说→产出(produce) / {是否,再问}→令 / 倘若→如果 / 答→返回。
 */
import { ZH_CN } from '@aster-cloud/aster-lang-ts/browser';
import type { Lexicon } from '@aster-cloud/aster-lang-ts/browser';
import { toCanonical, type LayoutSpan } from '@/lib/layout-map';

/** SemanticTokenKind 字面量（与 poem-demo 的 K 对齐，避免运行时依赖内部枚举）。 */
const K = {
  MODULE_DECL: 'MODULE_DECL',
  FUNC_TO: 'FUNC_TO',
  FUNC_GIVEN: 'FUNC_GIVEN',
  FUNC_PRODUCE: 'FUNC_PRODUCE',
  IF: 'IF',
  LET: 'LET',
  RETURN: 'RETURN',
} as const;

/** 一个「信物」前提：用户拨动即在「匹配字符串」与「不匹配字符串」间切换传给引擎。 */
export interface GuyongToken {
  /** 规范入参名（传给 evaluate，如 '光'）。 */
  name: string;
  /** 展示给用户的信物短语（如 '守着心里那点光'）。 */
  label: string;
  /** 拨到「真」时传给引擎的字符串（须与规范源码里比较的字面量一致，如 '守'）。 */
  matchValue: string;
  /** 拨到「假」时传给引擎的字符串（任意 ≠ matchValue 即可，如 '灭'）。 */
  missValue: string;
}

/** 引擎推导的中间值（let 绑定，供展示推导链）。 */
export interface GuyongDerived {
  /** 中间值名（规范，如 '归心'）。 */
  name: string;
  /** 展示标签（如 '归心 = 守 且 进 且 记'）。 */
  label: string;
  /** 由哪些信物名以 AND 组合得出（前端复算展示用，非引擎真值——真值仍由 evaluate 给）。 */
  from: string[];
}

/** 《孤勇》decision demo 的完整配置。 */
export interface GuyongConfig {
  /** 标题（展示）。 */
  title: string;
  /** 题解（展示）。 */
  attribution: string;
  /** 叠加《孤勇》别名的 Lexicon。 */
  lexicon: Lexicon;
  /** 歌词体源码（原创歌词逐字即源码，带语法必需空格；= toCanonical(layout)）。 */
  source: string;
  /** 规范关键词版（证明歌词体 ≡ 规范版，结构一致 Core IR）。 */
  canonical: string;
  /** LayoutMap：显示走 toDisplay（无空格流动歌词），编译走 toCanonical（= source）。 */
  layout: readonly LayoutSpan[];
  /** 入口 rule 名（规范名；歌词体与规范版共用）。 */
  entry: string;
  /** 三个信物前提。 */
  tokens: GuyongToken[];
  /** 引擎推导的中间值。 */
  derived: GuyongDerived[];
  /** 全部信物匹配时的裁决（= evaluate 结果，CI 锁定）。 */
  verdictAll: string;
  /** 任一信物不匹配时的裁决（= evaluate 结果，CI 锁定）。 */
  verdictElse: string;
}

const GUYONG_ZH = 'guyong-zh';

const SP: LayoutSpan = { canonical: ' ', display: '' };

/**
 * 《孤勇》LayoutMap：`toCanonical` 精确复原 source（带空格规范源码），`toDisplay` 隐去关键词间
 * 空格、把结构标点换回歌词标点，呈现无空格流动歌词。不变式（compile 测试钉死）：
 * toCanonical(GUYONG_LAYOUT) === GUYONG.source。
 */
const GUYONG_LAYOUT: readonly LayoutSpan[] = [
  { text: '孤身' }, SP, { text: '入夜的城' }, { canonical: '。\n', display: '，\n' },
  { text: '我问' }, SP, { text: '裁决' }, SP, { text: '凭' }, SP, { text: '光' }, { canonical: ', ', display: '、' },
  { text: '步' }, { canonical: ', ', display: '、' }, { text: '路' }, SP, { text: '我说' }, { canonical: ':\n  ', display: '，\n' },
  { text: '是否' }, SP, { text: '守' }, SP, { text: '定义为' }, SP, { text: '光' }, SP, { text: '等于' }, SP, { text: '「守」' }, { canonical: '。\n  ', display: '，' },
  { text: '是否' }, SP, { text: '进' }, SP, { text: '定义为' }, SP, { text: '步' }, SP, { text: '等于' }, SP, { text: '「进」' }, { canonical: '。\n  ', display: '，' },
  { text: '是否' }, SP, { text: '记' }, SP, { text: '定义为' }, SP, { text: '路' }, SP, { text: '等于' }, SP, { text: '「记」' }, { canonical: '。\n  ', display: '，\n' },
  { text: '再问' }, SP, { text: '归心' }, SP, { text: '定义为' }, SP, { text: '守' }, SP, { text: '并且' }, SP, { text: '进' }, SP, { text: '并且' }, SP, { text: '记' }, { canonical: '。\n  ', display: '，\n' },
  { text: '倘若' }, SP, { text: '归心' }, { canonical: ':\n    ', display: '，' },
  { text: '答' }, SP, { text: '「归途」' }, { canonical: '。\n  ', display: '。\n' },
  { text: '否则' }, { canonical: ':\n    ', display: '，' },
  { text: '答' }, SP, { text: '「坠落」' }, { canonical: '。', display: '。' },
];

/**
 * 《孤勇》——原创叙事体歌词逐字即源码（本项目原创，非任何既有歌曲）：
 *   孤身入夜的城
 *   我问裁决，凭光、步、路
 *   是否守（光等于「守」）、是否进（步等于「进」）、是否记（路等于「记」）
 *   再问归心（守且进且记）
 *   倘若归心 → 归途；否则 → 坠落
 * 领字经别名变结构关键词；三信物当字符串入参，引擎用「等于」比较确定真值，再 并且 合成裁决。
 */
export const GUYONG: GuyongConfig = {
  title: '孤勇 · 原创歌词即源码',
  attribution: '本项目原创词（非既有歌曲）· 三信物即前提，引擎真推导裁决：归途 / 坠落',
  lexicon: {
    ...ZH_CN,
    id: GUYONG_ZH,
    name: '孤勇（中文）',
    aliases: {
      [K.MODULE_DECL]: ['孤身'], // 「孤身 入夜的城」→ 模块
      [K.FUNC_TO]: ['我问'], // 「我问 裁决」→ 规则
      [K.FUNC_GIVEN]: ['凭'], // 「凭 光, 步, 路」→ 给定（入参表）
      [K.FUNC_PRODUCE]: ['我说'], // 「…我说:」→ 产出（块起始，紧贴冒号）
      [K.LET]: ['是否', '再问'], // 「是否 守…」/「再问 归心…」→ 令
      [K.IF]: ['倘若'], // 「倘若 归心」→ 如果
      [K.RETURN]: ['答'], // 「答 …」→ 返回
    },
  } as Lexicon,
  source: `孤身 入夜的城。
我问 裁决 凭 光, 步, 路 我说:
  是否 守 定义为 光 等于 「守」。
  是否 进 定义为 步 等于 「进」。
  是否 记 定义为 路 等于 「记」。
  再问 归心 定义为 守 并且 进 并且 记。
  倘若 归心:
    答 「归途」。
  否则:
    答 「坠落」。`,
  canonical: `模块 入夜的城。
规则 裁决 给定 光, 步, 路 产出:
  令 守 定义为 光 等于 「守」。
  令 进 定义为 步 等于 「进」。
  令 记 定义为 路 等于 「记」。
  令 归心 定义为 守 并且 进 并且 记。
  如果 归心:
    返回 「归途」。
  否则:
    返回 「坠落」。`,
  layout: GUYONG_LAYOUT,
  entry: '裁决',
  tokens: [
    { name: '光', label: '守着心里那点光', matchValue: '守', missValue: '灭' },
    { name: '步', label: '一步也不曾退', matchValue: '进', missValue: '退' },
    { name: '路', label: '记得来时那条路', matchValue: '记', missValue: '忘' },
  ],
  derived: [
    { name: '守', label: '守 = 光 等于「守」', from: ['光'] },
    { name: '进', label: '进 = 步 等于「进」', from: ['步'] },
    { name: '记', label: '记 = 路 等于「记」', from: ['路'] },
    { name: '归心', label: '归心 = 守 且 进 且 记', from: ['光', '步', '路'] },
  ],
  verdictAll: '归途',
  verdictElse: '坠落',
};

/** 供测试断言 LayoutMap 不变式：编译源码 = toCanonical(layout)。 */
export function guyongCompileSource(): string {
  return toCanonical(GUYONG.layout);
}

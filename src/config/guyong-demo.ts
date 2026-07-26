/**
 * 「原创歌词即源码」demo 配置（中文 zh 专属）——《孤勇》(原创词/曲：本项目原创，非任何既有歌曲)。
 *
 * 范式 = **布尔 decision（裁决规则）+ LayoutMap（显示/编译解耦）**：一段**原创**叙事体歌词按词序即
 * 源码。五个前提是**布尔入参**（孤光/未退/来路/不灭/彼岸，双字意象词即变量名），用户拨动 toggle 即把
 * true/false 直接传给引擎，引擎 令 归心 = 孤光 并且 未退 并且 来路 并且 不灭 并且 彼岸，再 如果/否则
 * 真判定输出裁决——翻任一前提裁决即变，引擎**真推导**。
 *
 * ★为什么用布尔（不用字符串比较）：早期版把前提当字符串、引擎「等于」比较确定真值，
 *   但比较字面量「守/进/记」是引擎真求值的内容 span，LayoutMap 不能隐（否则=显示欺骗），
 *   会在意象词后回声（如「守着『守』」）读不成中文。改真布尔后**无比较字面量**，
 *   `作为 布尔`/`定义为`/`并且`/`如果` 等语法脚手架经 LayoutMap 隐进结构 span，
 *   显示层只露意象词，读成有意境的中文；真值由 toggle 携带，诚实不变。
 *
 * ★歌词原创声明：全部歌词为本项目原创，不取自任何既有歌曲；主题「孤勇与救赎」。
 *
 * ★LayoutMap：页面**显示** toDisplay（脚手架隐成标点/换行，只露意象），引擎**编译** toCanonical
 *   （语法必需的带空格规范源码）。不变式：toCanonical(GUYONG_LAYOUT) === source。
 *
 * ★诚实契约（已用生产同款 TS 引擎实证，见 guyong-demo.compile.test.ts）：
 *  1. 歌词体源码用《孤勇》别名词典编译成功（无诊断错误）。
 *  2. 歌词体版 ≡ 规范关键词版（剥 origin 后结构一致 Core IR）——别名只在 canonicalize 表层。
 *  3. LayoutMap 不变式：toCanonical(layout) 逐字 === source；toDisplay 保留全部意象内容 span。
 *  4. 裁决真推导：五前提全真 → 「归途」；翻任一 → 「坠落」（引擎真判定，翻转随前提）。
 *
 * 别名：孤身→模块 / 我问→规则 / 凭→给定 / 我说→产出(produce) / 是否→令 / 倘若→如果 / 答→返回。
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

/** 一个布尔前提：用户拨动即把 true/false 直接传给引擎（真布尔 decision，无比较字面量）。 */
export interface GuyongToken {
  /** 规范入参名（= 布尔入参名，传给 evaluate，如 '守'）。 */
  name: string;
  /** 展示给用户的意象短语（如 '守着心里那点光'）。 */
  label: string;
}

/** 引擎推导的中间值（let 绑定，供展示推导链）。 */
export interface GuyongDerived {
  /** 中间值名（规范，如 '归心'）。 */
  name: string;
  /** 展示标签（如 '归心 = 孤光 且 未退 且 来路 且 不灭 且 彼岸'）。 */
  label: string;
  /** 由哪些前提名以 AND 组合得出（前端复算展示用，非引擎真值——真值仍由 evaluate 给）。 */
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
  /** 五个布尔前提。 */
  tokens: GuyongToken[];
  /** 引擎推导的中间值。 */
  derived: GuyongDerived[];
  /** 全部前提为真时的裁决（= evaluate 结果，CI 锁定）。 */
  verdictAll: string;
  /** 任一前提为假时的裁决（= evaluate 结果，CI 锁定）。 */
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
  // 规则头：语法脚手架（我问/凭/作为 布尔/我说）全隐进结构 span，只露意象词 裁决/孤光/未退/来路/不灭/彼岸。
  { canonical: '我问 ', display: '我把' }, { text: '裁决' }, { canonical: ' 凭 ', display: '，交给' },
  { text: '孤光' }, { canonical: ' 作为 布尔, ', display: '、' }, { text: '未退' }, { canonical: ' 作为 布尔, ', display: '、' },
  { text: '来路' }, { canonical: ' 作为 布尔, ', display: '、' }, { text: '不灭' }, { canonical: ' 作为 布尔, ', display: '、' },
  { text: '彼岸' }, { canonical: ' 作为 布尔 我说', display: '，这五样' }, { canonical: ':\n  ', display: '：\n' },
  // let 归心：只隐语法脚手架（定义为/并且），★AND 操作数 孤光/未退/来路/不灭/彼岸 是真实语义,必须保留为内容 span
  //   （否则=显示欺骗:隐藏参与求值的变量引用）。定义为→「是」、并且→「、」。
  { canonical: '是否 ', display: '' }, { text: '归心' }, { canonical: ' 定义为 ', display: '，是' },
  { text: '孤光' }, { canonical: ' 并且 ', display: '、' }, { text: '未退' }, { canonical: ' 并且 ', display: '、' },
  { text: '来路' }, { canonical: ' 并且 ', display: '、' }, { text: '不灭' }, { canonical: ' 并且 ', display: '、' },
  { text: '彼岸' }, { canonical: '', display: '俱在时才有' }, { canonical: '。\n  ', display: '。\n' },
  // if/else：`倘若/答/否则` 隐成连接词，露 归心/「归途」/「坠落」。
  { canonical: '倘若 ', display: '' }, { text: '归心' }, { canonical: ':\n    答 ', display: '还在，我便循着' },
  { text: '「归途」' }, { canonical: '。\n  ', display: '；\n' },
  { canonical: '否则', display: '五样缺一' }, { canonical: ':\n    答 ', display: '，就是' },
  { text: '「坠落」' }, { canonical: '。', display: '。' },
];

/**
 * 《孤勇》——原创叙事体歌词逐字即源码（本项目原创，非任何既有歌曲）。
 * 显示层（toDisplay，脚手架经 LayoutMap 隐去后）读作：
 *   孤身入夜的城，
 *   我把裁决，交给孤光、未退、来路、不灭、彼岸，这五样：
 *   归心，是孤光、未退、来路、不灭、彼岸俱在时才有。
 *   归心还在，我便循着「归途」；
 *   五样缺一，就是「坠落」。
 * 领字经别名变结构关键词；孤光/未退/来路/不灭/彼岸 是五个**布尔前提**（双字意象词即变量名，
 * toggle 传 true/false），引擎 令 归心 = 孤光 并且 未退 并且 来路 并且 不灭 并且 彼岸，再 如果/否则 真判定裁决。
 */
export const GUYONG: GuyongConfig = {
  title: '孤勇 · 原创歌词即源码',
  attribution: '本项目原创词（非既有歌曲）· 五个布尔前提，引擎真推导裁决：归途 / 坠落',
  lexicon: {
    ...ZH_CN,
    id: GUYONG_ZH,
    name: '孤勇（中文）',
    aliases: {
      [K.MODULE_DECL]: ['孤身'], // 「孤身 入夜的城」→ 模块
      [K.FUNC_TO]: ['我问'], // 「我问 裁决」→ 规则
      [K.FUNC_GIVEN]: ['凭'], // 「凭 守, 进, 记 作为 布尔」→ 给定（布尔入参表）
      [K.FUNC_PRODUCE]: ['我说'], // 「…我说:」→ 产出（块起始，紧贴冒号）
      [K.LET]: ['是否'], // 「是否 归心 定义为…」→ 令
      [K.IF]: ['倘若'], // 「倘若 归心」→ 如果
      [K.RETURN]: ['答'], // 「答 …」→ 返回
    },
  } as Lexicon,
  source: `孤身 入夜的城。
我问 裁决 凭 孤光 作为 布尔, 未退 作为 布尔, 来路 作为 布尔, 不灭 作为 布尔, 彼岸 作为 布尔 我说:
  是否 归心 定义为 孤光 并且 未退 并且 来路 并且 不灭 并且 彼岸。
  倘若 归心:
    答 「归途」。
  否则:
    答 「坠落」。`,
  canonical: `模块 入夜的城。
规则 裁决 给定 孤光 作为 布尔, 未退 作为 布尔, 来路 作为 布尔, 不灭 作为 布尔, 彼岸 作为 布尔 产出:
  令 归心 定义为 孤光 并且 未退 并且 来路 并且 不灭 并且 彼岸。
  如果 归心:
    返回 「归途」。
  否则:
    返回 「坠落」。`,
  layout: GUYONG_LAYOUT,
  entry: '裁决',
  tokens: [
    { name: '孤光', label: '孤光 · 守着心里那点光' },
    { name: '未退', label: '未退 · 一步也不曾退' },
    { name: '来路', label: '来路 · 记得来时那条路' },
    { name: '不灭', label: '不灭 · 心里那盏灯不灭' },
    { name: '彼岸', label: '彼岸 · 望得见彼岸的轮廓' },
  ],
  derived: [
    {
      name: '归心',
      label: '归心 = 孤光 且 未退 且 来路 且 不灭 且 彼岸',
      from: ['孤光', '未退', '来路', '不灭', '彼岸'],
    },
  ],
  verdictAll: '归途',
  verdictElse: '坠落',
};

/** 供测试断言 LayoutMap 不变式：编译源码 = toCanonical(layout)。 */
export function guyongCompileSource(): string {
  return toCanonical(GUYONG.layout);
}

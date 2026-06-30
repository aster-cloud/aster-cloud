/**
 * 「源码即诗」demo 配置（公开，三语：zh/de/hi）
 *
 * 与早期「字符串诗」不同：这里**诗句本身就是 Aster 代码**——每一行诗是一个真正的可编译规则
 * （变量、运算、调用），**没有任何字符串字面量**。「运行诗」= 执行这些由诗句改造成的语句，
 * 输出是**计算出的值**，不是预写诗句的打印。诗读起来是诗，跑起来是程序，每句都在真算。
 *
 * 结构（每语一首夜/月主题小诗，三行三规则）：
 *   月光(星) = 星 × 星        —— 满天星光彼此相乘，是夜的光
 *   霜(星)   = 月光(星) − 星  —— 光落成霜，减去星的清冷
 *   思(星)   = 霜(星) + 月光(星)  —— 霜与月光相偕，是思念（含无括号 apply 调用）
 *
 * 关键词被别名成诗词（ADR 0022），无括号单参调用用 apply 形（ADR 0027）。canonicalize 归一回
 * 规范关键词 → 诗体版 ≡ 规范版（结构一致 Core IR）。客户端浏览器内 TS 引擎，即时可验。
 */
import { ZH_CN, DE_DE, HI_IN } from '@aster-cloud/aster-lang-ts/browser';
import type { Lexicon } from '@aster-cloud/aster-lang-ts/browser';

export type PoemLocale = 'zh' | 'de' | 'hi';

/** 把 next-intl 的 locale 收敛到本 demo 支持的三语（未知回退 zh）。 */
export function toPoemLocale(locale: string): PoemLocale {
  const l = locale.toLowerCase();
  if (l.startsWith('de')) return 'de';
  if (l.startsWith('hi')) return 'hi';
  return 'zh';
}

/** SemanticTokenKind 字面量（避免运行时依赖内部枚举；值与 token-kind.ts 对齐）。 */
const K = {
  MODULE_DECL: 'MODULE_DECL',
  FUNC_TO: 'FUNC_TO',
  FUNC_GIVEN: 'FUNC_GIVEN',
  RETURN: 'RETURN',
  PLUS: 'PLUS',
  MINUS_WORD: 'MINUS_WORD',
  TIMES: 'TIMES',
  APPLY: 'APPLY',
} as const;

/** 一行诗 = 一个规则：诗句原文（展示）+ 入口名（求值用）+ 该行算出什么的说明。 */
export interface PoemLine {
  /** 诗句原文（源码里这一行，逐字展示）。 */
  verse: string;
  /** 该行对应的规则名（求值入口，规范名）。 */
  rule: string;
  /** 这一句「在算什么」的本地化短说明（trace 展示用，非字符串字面量，纯 UI 文案）。 */
  meaning: string;
}

/** 一首「诗即代码」的完整 demo 配置。 */
export interface PoemConfig {
  /** 诗名（展示用）。 */
  title: string;
  /** 题解 / 主题（展示用）。 */
  attribution: string;
  /** 叠加诗词别名的 Lexicon。 */
  lexicon: Lexicon;
  /** 诗体源码（每行是真规则，无字符串字面量）。 */
  source: string;
  /** 规范关键词版（证明诗体版 ≡ 规范版，结构一致 Core IR）。 */
  canonical: string;
  /** 入参名（本地化，所有规则共用同一入参）。 */
  param: string;
  /** 演示入参值（代入这个数跑出每行的计算值）。 */
  sample: number;
  /** 逐行（逐规则）：原文 + 入口 + 含义。trace 按此逐行求值展示。 */
  lines: PoemLine[];
}

// ── ZH — 夜/月主题（原创短诗，公有领域）──────────────────────────────────────
const POEM_ZH: PoemConfig = {
  title: '夜思（可执行）',
  attribution: '一首会计算的夜诗 · 每句皆为代码',
  lexicon: { ...ZH_CN, id: 'yesi-zh', name: '夜思（中文）', aliases: {
    [K.MODULE_DECL]: ['夜'], [K.FUNC_TO]: ['取'], [K.FUNC_GIVEN]: ['自'], [K.RETURN]: ['是'],
    [K.PLUS]: ['偕'], [K.MINUS_WORD]: ['损'], [K.TIMES]: ['叠'], [K.APPLY]: ['吟'],
  } } as Lexicon,
  source: `夜 始。

取 月光 自 星：
  是 星 叠 星。

取 霜 自 星：
  是 月光(星) 损 星。

取 思 自 星：
  是 霜(星) 偕 吟 月光 设为 星。`,
  canonical: `模块 始。

规则 月光 给定 星：
  返回 星 乘以 星。

规则 霜 给定 星：
  返回 月光(星) 减去 星。

规则 思 给定 星：
  返回 霜(星) 加上 应用 月光 设为 星。`,
  param: '星', sample: 3,
  lines: [
    { verse: '是 星 叠 星', rule: '月光', meaning: '星光彼此相乘 = 星 × 星' },
    { verse: '是 月光(星) 损 星', rule: '霜', meaning: '月光落成霜 = 月光 − 星' },
    { verse: '是 霜(星) 偕 吟 月光 设为 星', rule: '思', meaning: '霜与月光相偕 = 霜 + 月光（无括号 apply 调用）' },
  ],
};

// ── DE — Nacht/Mond 主题（原创，公有）────────────────────────────────────────
const POEM_DE: PoemConfig = {
  title: 'Nachtgedanke (ausführbar)',
  attribution: 'Ein rechnendes Nachtgedicht · jede Zeile ist Code',
  lexicon: { ...DE_DE, id: 'nacht-de', name: 'Nachtgedanke (Deutsch)', aliases: {
    [K.MODULE_DECL]: ['Nacht'], [K.FUNC_TO]: ['Vers'], [K.FUNC_GIVEN]: ['je'], [K.RETURN]: ['klingt'],
    [K.PLUS]: ['trifft'], [K.MINUS_WORD]: ['weicht'], [K.TIMES]: ['webt'], [K.APPLY]: ['ruf'],
  } } as Lexicon,
  source: `Nacht beginnt.

Vers mondlicht je sterne:
  klingt sterne webt sterne.

Vers schatten je sterne:
  klingt mondlicht(sterne) weicht sterne.

Vers sehnsucht je sterne:
  klingt schatten(sterne) trifft ruf mondlicht auf sterne.`,
  canonical: `Modul beginnt.

Regel mondlicht gegeben sterne:
  gib zurueck sterne mal sterne.

Regel schatten gegeben sterne:
  gib zurueck mondlicht(sterne) minus sterne.

Regel sehnsucht gegeben sterne:
  gib zurueck schatten(sterne) plus wende an mondlicht auf sterne.`,
  param: 'sterne', sample: 3,
  lines: [
    { verse: 'klingt sterne webt sterne', rule: 'mondlicht', meaning: 'Sternenlicht webt sich = sterne × sterne' },
    { verse: 'klingt mondlicht(sterne) weicht sterne', rule: 'schatten', meaning: 'Licht weicht zum Schatten = mondlicht − sterne' },
    { verse: 'klingt schatten(sterne) trifft ruf mondlicht auf sterne', rule: 'sehnsucht', meaning: 'Schatten trifft Mondlicht = schatten + mondlicht (klammerfreier apply-Aufruf)' },
  ],
};

// ── HI — रात/चाँद 主题（原创，公有）──────────────────────────────────────────
const POEM_HI: PoemConfig = {
  title: 'रात का विचार (चलने योग्य)',
  attribution: 'एक गणना करती रात-कविता · हर पंक्ति कोड है',
  lexicon: { ...HI_IN, id: 'raat-hi', name: 'रात का विचार (हिन्दी)', aliases: {
    [K.MODULE_DECL]: ['रात'], [K.FUNC_TO]: ['लो'], [K.FUNC_GIVEN]: ['पाए'], [K.RETURN]: ['गाए'],
    [K.PLUS]: ['मिले'], [K.MINUS_WORD]: ['छीने'], [K.TIMES]: ['बुने'], [K.APPLY]: ['पुकारे'],
  } } as Lexicon,
  source: `रात आरंभ।

लो चाँदनी पाए तारे:
  गाए तारे बुने तारे।

लो छाया पाए तारे:
  गाए चाँदनी(तारे) छीने तारे।

लो विरह पाए तारे:
  गाए छाया(तारे) मिले पुकारे चाँदनी को तारे।`,
  canonical: `मॉड्यूल आरंभ।

नियम चाँदनी दिया गया तारे:
  लौटाएं तारे गुणा तारे।

नियम छाया दिया गया तारे:
  लौटाएं चाँदनी(तारे) घटा तारे।

नियम विरह दिया गया तारे:
  लौटाएं छाया(तारे) जोड़ लागू करें चाँदनी को तारे।`,
  param: 'तारे', sample: 3,
  lines: [
    { verse: 'गाए तारे बुने तारे', rule: 'चाँदनी', meaning: 'तारों की रोशनी बुनती है = तारे × तारे' },
    { verse: 'गाए चाँदनी(तारे) छीने तारे', rule: 'छाया', meaning: 'रोशनी छाया में ढले = चाँदनी − तारे' },
    { verse: 'गाए छाया(तारे) मिले पुकारे चाँदनी को तारे', rule: 'विरह', meaning: 'छाया चाँदनी से मिले = छाया + चाँदनी (बिना-कोष्ठक apply कॉल)' },
  ],
};

export const POEMS: Record<PoemLocale, PoemConfig> = {
  zh: POEM_ZH,
  de: POEM_DE,
  hi: POEM_HI,
};

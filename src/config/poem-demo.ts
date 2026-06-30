/**
 * 「源码即诗」demo 配置（公开，四语）
 *
 * 展示 Aster 关键词别名机制（ADR 0022）+ 无括号单参调用（ADR 0027）的极致：一段 `.aster`
 * 源码**本身读起来就是一首（各语种家喻户晓的）诗**，却仍由生产同款浏览器引擎逐字编译、
 * 递归执行。每种界面语言配一首该语言的名诗，**轻改**成可编译执行的 Aster 版（结构词被别名成
 * 诗的词、递归调用用无括号 apply 形）。别名只在 canonicalize 阶段归一回规范关键词——故「诗体
 * 源码」与「规范关键词版」编译到结构一致的 Core IR。客户端纯静态 + 浏览器内 TS 引擎，即时可验。
 *
 * 选诗（均公有领域 / 家喻户晓）：
 *   en — Nightfall（原创夜曲，承 examples/alias-poem-story）
 *   de — Goethe《Wandrers Nachtlied》(Über allen Gipfeln ist Ruh)
 *   zh — 李白《静夜思》
 *   hi — 童谣《चंदा मामा दूर के》(月亮舅舅)
 */
import { EN_US, ZH_CN, DE_DE, HI_IN } from '@aster-cloud/aster-lang-ts/browser';
import type { Lexicon } from '@aster-cloud/aster-lang-ts/browser';

export type PoemLocale = 'en' | 'zh' | 'de' | 'hi';

/** 把 next-intl 的 locale 收敛到本 demo 支持的四语（未知回退 en）。 */
export function toPoemLocale(locale: string): PoemLocale {
  const l = locale.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('de')) return 'de';
  if (l.startsWith('hi')) return 'hi';
  return 'en';
}

/** SemanticTokenKind 字面量（避免运行时依赖内部枚举；值与 token-kind.ts 对齐）。 */
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

/** 一首诗的完整 demo 配置。 */
export interface PoemConfig {
  /** 诗名（展示用，原文）。 */
  title: string;
  /** 作者 / 出处（展示用）。 */
  attribution: string;
  /** 叠加诗词别名的 Lexicon（base = 该语言词典）。 */
  lexicon: Lexicon;
  /** 诗体源码（逐行读是诗，逐 token 编译是递归函数）。 */
  source: string;
  /** 规范关键词版（证明诗体版 ≡ 规范版，结构一致 Core IR）。 */
  canonical: string;
  /** 入口 rule 名（规范名）。 */
  entry: string;
  /** 入参名（递归的「行号 / 星数」，本地化）。 */
  param: string;
  /** 起始入参值（从第几行 / 几颗星开始）。 */
  start: number;
  /** 预期完整吟诵（引擎执行结果，逐字一致，CI 锁定）。 */
  expect: string;
  /** 把吟诵结果切回逐句诗行的分隔标记（每行以此为界，UI 展示用）。 */
  lineMarkers: string[];
}

// ── EN — Nightfall（原创夜曲）─────────────────────────────────────────────────
const EN_LAST = 'and one last light to keep the dark from me';
const EN_MORE = ' and one more light to set the evening free';
const POEM_EN: PoemConfig = {
  title: 'Nightfall',
  attribution: 'An original night-song',
  lexicon: { ...EN_US, id: 'nightfall-en', name: 'Nightfall (English)', aliases: {
    [K.MODULE_DECL]: ['Nightfall'], [K.FUNC_TO]: ['I'], [K.FUNC_GIVEN]: ['count'],
    [K.IF]: ['while'], [K.RETURN]: ['sing'], [K.LET]: ['let'], [K.BE]: ['be'],
    [K.PLUS]: ['with'], [K.MINUS_WORD]: ['less'], [K.AT_MOST]: ['but'], [K.APPLY]: ['echoing'],
  } } as Lexicon,
  source: `Nightfall comes.

I gather count stars:
  while stars but 1
    sing "${EN_LAST}".
  let earlier be echoing gather to stars less 1.
  sing earlier with "${EN_MORE}".`,
  canonical: `Module comes.

Rule gather given stars:
  If stars at most 1
    Return "${EN_LAST}".
  Let earlier be apply gather to stars minus 1.
  Return earlier + "${EN_MORE}".`,
  entry: 'gather', param: 'stars', start: 3,
  expect: EN_LAST + EN_MORE + EN_MORE,
  lineMarkers: [EN_MORE.trimStart()],
};

// ── DE — Goethe《Wandrers Nachtlied》(Über allen Gipfeln) ────────────────────
const DE_L1 = 'Über allen Gipfeln ist Ruh, ';
const DE_L2 = 'in allen Wipfeln spürest du kaum einen Hauch; ';
const DE_L3 = 'die Vögelein schweigen im Walde. ';
const DE_L4 = 'Warte nur, balde ruhest du auch.';
const POEM_DE: PoemConfig = {
  title: 'Wandrers Nachtlied',
  attribution: 'Johann Wolfgang von Goethe (1780)',
  lexicon: { ...DE_DE, id: 'nachtlied-de', name: 'Nachtlied (Deutsch)', aliases: {
    [K.MODULE_DECL]: ['Nachtlied'], [K.FUNC_TO]: ['Ich'], [K.FUNC_GIVEN]: ['singe'],
    [K.IF]: ['solange'], [K.RETURN]: ['flüstre'], [K.AT_MOST]: ['bis'], [K.APPLY]: ['sprich'],
  } } as Lexicon,
  source: `Nachtlied beginnt.

Ich wandere singe zeile:
  solange zeile bis 1
    flüstre "${DE_L1}" plus sprich wandere auf zeile plus 1.
  solange zeile bis 2
    flüstre "${DE_L2}" plus sprich wandere auf zeile plus 1.
  solange zeile bis 3
    flüstre "${DE_L3}" plus sprich wandere auf zeile plus 1.
  flüstre "${DE_L4}".`,
  canonical: `Modul beginnt.

Regel wandere gegeben zeile:
  wenn zeile hoechstens 1
    gib zurueck "${DE_L1}" plus wende an wandere auf zeile plus 1.
  wenn zeile hoechstens 2
    gib zurueck "${DE_L2}" plus wende an wandere auf zeile plus 1.
  wenn zeile hoechstens 3
    gib zurueck "${DE_L3}" plus wende an wandere auf zeile plus 1.
  gib zurueck "${DE_L4}".`,
  entry: 'wandere', param: 'zeile', start: 1,
  expect: DE_L1 + DE_L2 + DE_L3 + DE_L4,
  lineMarkers: [DE_L2, DE_L3, DE_L4],
};

// ── ZH — 李白《静夜思》────────────────────────────────────────────────────────
const ZH_L1 = '床前明月光，';
const ZH_L2 = '疑是地上霜。';
const ZH_L3 = '举头望明月，';
const ZH_L4 = '低头思故乡。';
const POEM_ZH: PoemConfig = {
  title: '静夜思',
  attribution: '李白 · 唐',
  lexicon: { ...ZH_CN, id: 'jingyesi-zh', name: '静夜思（中文）', aliases: {
    [K.MODULE_DECL]: ['静夜思'], [K.FUNC_TO]: ['吟'], [K.FUNC_GIVEN]: ['第'],
    [K.IF]: ['若'], [K.RETURN]: ['诵'], [K.AT_MOST]: ['不过'], [K.APPLY]: ['续'],
  } } as Lexicon,
  source: `静夜思 起。

吟 recite 第 句：
  若 句 不过 1
    诵 「${ZH_L1}」 加上 续 recite 设为 句 加上 1。
  若 句 不过 2
    诵 「${ZH_L2}」 加上 续 recite 设为 句 加上 1。
  若 句 不过 3
    诵 「${ZH_L3}」 加上 续 recite 设为 句 加上 1。
  诵 「${ZH_L4}」。`,
  canonical: `模块 起。

规则 recite 给定 句：
  如果 句 至多 1
    返回 「${ZH_L1}」 加上 应用 recite 设为 句 加上 1。
  如果 句 至多 2
    返回 「${ZH_L2}」 加上 应用 recite 设为 句 加上 1。
  如果 句 至多 3
    返回 「${ZH_L3}」 加上 应用 recite 设为 句 加上 1。
  返回 「${ZH_L4}」。`,
  entry: 'recite', param: '句', start: 1,
  expect: ZH_L1 + ZH_L2 + ZH_L3 + ZH_L4,
  lineMarkers: [ZH_L2, ZH_L3, ZH_L4],
};

// ── HI — कबीर 的 doha（15 世纪，公有领域，家喻户晓）─────────────────────────────
const HI_L1 = 'बड़ा हुआ तो क्या हुआ, ';
const HI_L2 = 'जैसे पेड़ खजूर। ';
const HI_L3 = 'पंथी को छाया नहीं, ';
const HI_L4 = 'फल लागे अति दूर॥';
const POEM_HI: PoemConfig = {
  title: 'कबीर का दोहा',
  attribution: 'संत कबीर · 15वीं सदी (public domain)',
  lexicon: { ...HI_IN, id: 'kabir-hi', name: 'दोहा (हिन्दी)', aliases: {
    [K.MODULE_DECL]: ['दोहा'], [K.FUNC_TO]: ['गाएँ'], [K.FUNC_GIVEN]: ['पंक्ति'],
    [K.IF]: ['जबतक'], [K.RETURN]: ['कहैं'], [K.AT_MOST]: ['तक'], [K.APPLY]: ['दोहराएँ'],
  } } as Lexicon,
  source: `दोहा आरंभ।

गाएँ recite पंक्ति n:
  जबतक n तक 1
    कहैं "${HI_L1}" जोड़ दोहराएँ recite को n जोड़ 1।
  जबतक n तक 2
    कहैं "${HI_L2}" जोड़ दोहराएँ recite को n जोड़ 1।
  जबतक n तक 3
    कहैं "${HI_L3}" जोड़ दोहराएँ recite को n जोड़ 1।
  कहैं "${HI_L4}"।`,
  canonical: `मॉड्यूल आरंभ।

नियम recite दिया गया n:
  यदि n अधिक से अधिक 1
    लौटाएं "${HI_L1}" जोड़ लागू करें recite को n जोड़ 1।
  यदि n अधिक से अधिक 2
    लौटाएं "${HI_L2}" जोड़ लागू करें recite को n जोड़ 1।
  यदि n अधिक से अधिक 3
    लौटाएं "${HI_L3}" जोड़ लागू करें recite को n जोड़ 1।
  लौटाएं "${HI_L4}"।`,
  entry: 'recite', param: 'n', start: 1,
  expect: HI_L1 + HI_L2 + HI_L3 + HI_L4,
  lineMarkers: [HI_L2, HI_L3, HI_L4],
};

export const POEMS: Record<PoemLocale, PoemConfig> = {
  en: POEM_EN,
  de: POEM_DE,
  zh: POEM_ZH,
  hi: POEM_HI,
};

/** 把吟诵结果按该诗的续句标记切回逐句诗行（UI 展示用，与 expect 同源）。 */
export function reciteLines(poem: PoemConfig, value: string): string[] {
  if (poem.lineMarkers.length === 0) return [value.trim()].filter(Boolean);
  const markerAlt = poem.lineMarkers
    .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return value
    .split(new RegExp(`(?=${markerAlt})`))
    .map((s) => s.trim())
    .filter(Boolean);
}

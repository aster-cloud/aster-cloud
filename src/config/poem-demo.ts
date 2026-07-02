/**
 * 「源码即诗」demo 配置（公开，四语：en/zh/de/hi），两种范式：
 *
 * **computed**（en/de/hi）——一首**连贯**诗，每段**上半诗句、下半真计算**：`Match` 选景、
 *   `List.range`/`List.sum` 真求和、无括号 `apply` 织段（en 为递归谣曲）。诗读连贯，但每个数、
 *   每次分支、每次求和都是引擎真求值——不是预写诗句的打印，而是计算与诗交织。
 *
 * **alias-literal**（zh《静夜思》，李白，公有领域）——整首诗按**原词序**即源码：关键词别名把
 *   诗句领字变结构关键词（床前→Module / 疑是→Rule / 举头→produce / 低头→Return），**字面量宏**
 *   （IdentifierKind.LITERAL）把末词展开成字符串字面量（思故乡→"静夜思"），运行输出诗名。
 *
 * 两种范式都靠 canonicalize 归一：关键词别名（ADR 0022）+ 无括号 apply（ADR 0027）+ 字面量宏
 * 只在表层，Lexer/Parser/Core IR 不知其存在 → 诗体版 ≡ 规范版（结构一致 Core IR）。客户端浏览器
 * 内 TS 引擎，即时可验。
 */
import { EN_US, ZH_CN, DE_DE, HI_IN, IdentifierKind } from '@aster-cloud/aster-lang-ts/browser';
import type { Lexicon, DomainVocabulary } from '@aster-cloud/aster-lang-ts/browser';

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
  FUNC_PRODUCE: 'FUNC_PRODUCE',
  IF: 'IF',
  LET: 'LET',
  BE: 'BE',
  RETURN: 'RETURN',
  MATCH: 'MATCH',
  WHEN: 'WHEN',
  PLUS: 'PLUS',
  MINUS_WORD: 'MINUS_WORD',
  AT_MOST: 'AT_MOST',
  APPLY: 'APPLY',
} as const;

/** 一次运行的样本：入参值 + 运行输出 + 这一遍背后「在做什么」的说明。 */
export interface PoemSample {
  /** 入口 rule 的入参值（computed 范式=计算驱动的量；alias-literal 范式=第几遍吟诵）。 */
  input: number;
  /**
   * 运行输出（引擎真求值结果，逐字一致，CI 锁定）。computed 范式=该入参算出的整首诗；
   * alias-literal 范式=诗名（恒定，宏展开与入参无关）。
   */
  woven: string;
  /** 这一遍背后「在算什么 / 展开了什么」的本地化短说明（trace 展示用，非诗本身）。 */
  computed: string;
}

/**
 * 一首「诗即代码」的完整 demo 配置。
 *
 * 两种范式：
 *  - `computed`（en/de/hi）：诗句上半是诗、下半是真计算（Match+List+apply），
 *    每个 input 算出不同的整首诗（计算驱动）。
 *  - `alias-literal`（zh《静夜思》）：整首诗按**原词序**即源码，关键词别名把诗句领字
 *    变结构关键词，**字面量宏**（IdentifierKind.LITERAL）把末词展开成字符串字面量
 *    （思故乡→"静夜思"）；运行任意 input 都输出诗名「静夜思」。
 */
export interface PoemConfig {
  /** 诗名（展示用）。 */
  title: string;
  /** 题解 / 主题（展示用）。 */
  attribution: string;
  /** 叠加诗词别名的 Lexicon。 */
  lexicon: Lexicon;
  /**
   * 范式：'computed'（计算驱动，每 input 不同）或 'alias-literal'（源码即诗 + 字面量宏，
   * 运行恒输出诗名）。缺省 'computed'（向后兼容既有三语）。
   */
  paradigm?: 'computed' | 'alias-literal';
  /**
   * 可选：字面量宏词汇表（IdentifierKind.LITERAL）。存在时 compile 前 registerCustom，
   * 并以 `domain`（= vocab.id）+ `tenantId`（= vocab.id）触发字面量宏展开。
   * 注：aster-lang-ts 的 compile 用 lexicon.id 作 locale 查词汇，故 vocab.locale 须 = lexicon.id。
   */
  vocab?: DomainVocabulary;
  /** 诗体源码（连贯一首，Match + List + apply，诗句即代码）。 */
  source: string;
  /** 规范关键词版（证明诗体版 ≡ 规范版，结构一致 Core IR）。 */
  canonical: string;
  /** 入口 rule 名（织成整首诗的入口，规范名）。 */
  entry: string;
  /** 入参名（本地化）。 */
  param: string;
  /** 三个样本（夜深 1/2/3），每个：入参 + 算出的整首诗 + 计算说明。 */
  samples: PoemSample[];
}

// ── EN — Nightfall（原「源码即诗」递归谣曲，与 examples/alias-poem-story 同源）──────
// 不同于 zh/de/hi 的 Match+List 连贯诗：Nightfall 是一首**递归**谣曲——`gather(stars)` 用无括号
// apply 递归把 n 颗星的光一句一句聚拢，整段源码逐行读是一首诗。诗句是字符串，但递归结构本身
// 就是诗意（夜里一盏盏点灯），输出长短随入参（星数）增长。
const EN_LAST = 'and one last light to keep the dark from me';
const EN_MORE = ' and one more light to set the evening free';
const POEM_EN: PoemConfig = {
  title: 'Nightfall',
  attribution: 'A recursive night-song · the source itself is the poem',
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
  entry: 'gather', param: 'stars',
  samples: [
    { input: 1, woven: EN_LAST, computed: 'gather(1): base case (stars at most 1) → one last light' },
    { input: 2, woven: EN_LAST + EN_MORE, computed: 'gather(2): light + echoing gather to 1 → one more light' },
    { input: 3, woven: EN_LAST + EN_MORE + EN_MORE, computed: 'gather(3): light + echoing gather to 2 → two more lights, gathered one by one' },
  ],
};

// ── ZH — 静夜思（李白，公有领域）· 源码即诗 + 字面量宏 ────────────────────────
// 整首诗按**原词序**即源码：关键词别名把诗句领字变结构关键词（床前→Module / 疑是→Rule /
// 举头→produce / 低头→Return），**字面量宏**（IdentifierKind.LITERAL）把末词展开成字符串
// 字面量（思故乡→"静夜思"）。运行入口 rule「地上霜」输出诗名「静夜思」。
// 别名 + 字面量宏都只在 canonicalize 表层，Lexer/Parser/Core IR 不知其存在 → 诗体版 ≡ 规范版。
const JYS_DOMAIN = 'jingyesi-zh';
const POEM_ZH: PoemConfig = {
  title: '静夜思',
  attribution: '李白 · 整首诗即源码，运行输出诗名「静夜思」',
  paradigm: 'alias-literal',
  lexicon: { ...ZH_CN, id: JYS_DOMAIN, name: '静夜思（中文）', aliases: {
    [K.MODULE_DECL]: ['床前'], [K.FUNC_TO]: ['疑是'], [K.FUNC_PRODUCE]: ['举头'],
    [K.RETURN]: ['低头'],
  } } as Lexicon,
  // 字面量宏：思故乡 → 内容「静夜思」。vocab.locale 须 = lexicon.id（compile 用 lexicon.id 查词汇）。
  vocab: {
    id: JYS_DOMAIN, name: '静夜思', locale: JYS_DOMAIN, version: '1.0.0',
    structs: [], fields: [], functions: [], enumValues: [],
    literals: [{ localized: '思故乡', canonical: '静夜思', kind: IdentifierKind.LITERAL }],
  },
  source: `床前 明月光。
疑是 地上霜，举头 望明月：
  低头 思故乡。`,
  canonical: `模块 明月光。
规则 地上霜 产出 望明月：
  返回 「静夜思」。`,
  entry: '地上霜', param: '时',
  samples: [
    { input: 1, woven: '静夜思', computed: '床前 明月光 → 模块「明月光」；疑是 地上霜 → 规则「地上霜」' },
    { input: 2, woven: '静夜思', computed: '举头 望明月 → produce 望明月；低头 → Return' },
    { input: 3, woven: '静夜思', computed: '字面量宏：思故乡 → "静夜思"（canonicalize 表层展开）' },
  ],
};

// ── DE — Mondschau（原创连贯诗，公有领域）────────────────────────────────────
const POEM_DE: PoemConfig = {
  title: 'Mondschau',
  attribution: 'Ein rechnendes Mondgedicht · oben Vers, unten Rechnung',
  lexicon: { ...DE_DE, id: 'mondschau-de', name: 'Mondschau (Deutsch)', aliases: {
    [K.MODULE_DECL]: ['Nacht'], [K.FUNC_TO]: ['Vers'], [K.FUNC_GIVEN]: ['je'],
    [K.LET]: ['fasse'], [K.BE]: ['wird'], [K.RETURN]: ['sing'],
    [K.MATCH]: ['schau'], [K.WHEN]: ['zur'], [K.PLUS]: ['eint'], [K.APPLY]: ['ruf'],
  } } as Lexicon,
  source: `Nacht beginnt.

Vers mondbild je stunde:
  schau stunde:
    zur 1, sing "Der Neumond birgt das schwarze Meer, ".
    zur 2, sing "der Halbmond neigt sich still und schwer, ".
    zur 3, sing "der Vollmond steigt, die Welle hehr, ".

Vers sehnen je stunde:
  fasse funken wird List.range(1, stunde eint 1).
  fasse schein wird List.sum(funken).
  schau schein:
    zur 1, sing "ein einzig Licht begleitet mich.".
    zur 3, sing "drei Sterne und der Mond zugleich.".
    zur 6, sing "ein Sternenmeer führt heim mich.".

Vers mondschau je stunde:
  sing mondbild(stunde) eint ruf sehnen auf stunde.`,
  canonical: `Modul beginnt.

Regel mondbild gegeben stunde:
  pruefe stunde:
    bei 1, gib zurueck "Der Neumond birgt das schwarze Meer, ".
    bei 2, gib zurueck "der Halbmond neigt sich still und schwer, ".
    bei 3, gib zurueck "der Vollmond steigt, die Welle hehr, ".

Regel sehnen gegeben stunde:
  sei funken gleich List.range(1, stunde plus 1).
  sei schein gleich List.sum(funken).
  pruefe schein:
    bei 1, gib zurueck "ein einzig Licht begleitet mich.".
    bei 3, gib zurueck "drei Sterne und der Mond zugleich.".
    bei 6, gib zurueck "ein Sternenmeer führt heim mich.".

Regel mondschau gegeben stunde:
  gib zurueck mondbild(stunde) plus wende an sehnen auf stunde.`,
  entry: 'mondschau', param: 'stunde',
  samples: [
    { input: 1, woven: 'Der Neumond birgt das schwarze Meer, ein einzig Licht begleitet mich.', computed: 'sehnen(1): List.sum(List.range(1,2)) = 1 → „ein einzig Licht…"' },
    { input: 2, woven: 'der Halbmond neigt sich still und schwer, drei Sterne und der Mond zugleich.', computed: 'sehnen(2): List.sum(List.range(1,3)) = 1+2 = 3 → „drei Sterne…"' },
    { input: 3, woven: 'der Vollmond steigt, die Welle hehr, ein Sternenmeer führt heim mich.', computed: 'sehnen(3): List.sum(List.range(1,4)) = 1+2+3 = 6 → „ein Sternenmeer…"' },
  ],
};

// ── HI — चंद्रदर्शन（原创连贯诗，公有领域）─────────────────────────────────────
const POEM_HI: PoemConfig = {
  title: 'चंद्रदर्शन',
  attribution: 'एक गणना करती चंद्र-कविता · ऊपर पद्य, नीचे गणना',
  lexicon: { ...HI_IN, id: 'chandra-hi', name: 'चंद्रदर्शन (हिन्दी)', aliases: {
    [K.MODULE_DECL]: ['रात'], [K.FUNC_TO]: ['छंद'], [K.FUNC_GIVEN]: ['पहर'],
    [K.LET]: ['धरें'], [K.BE]: ['बने'], [K.RETURN]: ['गा'],
    [K.MATCH]: ['देखें'], [K.WHEN]: ['पल'], [K.PLUS]: ['संग'], [K.APPLY]: ['पुकारें'],
  } } as Lexicon,
  source: `रात आरंभ।

छंद चंद्रबिंब पहर समय:
  देखें समय:
    पल 1, गा "नवचंद्र छिपा, सागर श्याम, "।
    पल 2, गा "अर्धचंद्र झुका, जल विश्राम, "।
    पल 3, गा "पूर्णचंद्र उगा, लहर ललाम, "।

छंद विरह पहर समय:
  धरें कण बने List.range(1, समय संग 1)।
  धरें आभा बने List.sum(कण)।
  देखें आभा:
    पल 1, गा "एक दीप संग मेरे आज।"।
    पल 3, गा "तीन तारे चंद्र के साथ।"।
    पल 6, गा "नक्षत्र-सिंधु लौटाए पास।"।

छंद चंद्रदर्शन पहर समय:
  गा चंद्रबिंब(समय) संग पुकारें विरह को समय।`,
  canonical: `मॉड्यूल आरंभ।

नियम चंद्रबिंब दिया गया समय:
  मिलान समय:
    जब 1, लौटाएं "नवचंद्र छिपा, सागर श्याम, "।
    जब 2, लौटाएं "अर्धचंद्र झुका, जल विश्राम, "।
    जब 3, लौटाएं "पूर्णचंद्र उगा, लहर ललाम, "।

नियम विरह दिया गया समय:
  मानें कण हो List.range(1, समय जोड़ 1)।
  मानें आभा हो List.sum(कण)।
  मिलान आभा:
    जब 1, लौटाएं "एक दीप संग मेरे आज।"।
    जब 3, लौटाएं "तीन तारे चंद्र के साथ।"।
    जब 6, लौटाएं "नक्षत्र-सिंधु लौटाए पास।"।

नियम चंद्रदर्शन दिया गया समय:
  लौटाएं चंद्रबिंब(समय) जोड़ लागू करें विरह को समय।`,
  entry: 'चंद्रदर्शन', param: 'समय',
  samples: [
    { input: 1, woven: 'नवचंद्र छिपा, सागर श्याम, एक दीप संग मेरे आज।', computed: 'विरह(1): List.sum(List.range(1,2)) = 1 → „एक दीप…"' },
    { input: 2, woven: 'अर्धचंद्र झुका, जल विश्राम, तीन तारे चंद्र के साथ।', computed: 'विरह(2): List.sum(List.range(1,3)) = 1+2 = 3 → „तीन तारे…"' },
    { input: 3, woven: 'पूर्णचंद्र उगा, लहर ललाम, नक्षत्र-सिंधु लौटाए पास।', computed: 'विरह(3): List.sum(List.range(1,4)) = 1+2+3 = 6 → „नक्षत्र-सिंधु…"' },
  ],
};

export const POEMS: Record<PoemLocale, PoemConfig> = {
  en: POEM_EN,
  zh: POEM_ZH,
  de: POEM_DE,
  hi: POEM_HI,
};

/**
 * 「源码即诗」demo 配置（公开，三语：zh/de/hi）
 *
 * 一首**连贯**的望月诗（承 examples 的 tides 谣曲范式）：每段诗**上半是诗句、下半是真计算**——
 * `Match` 按更次/夜深选景，`List.range`/`List.sum` 真求和驱动「星辉」意象，无括号 `apply` 把
 * 各段织成整首诗。诗读下来是连贯的（夜深 → 望月 → 星河照归），但每个数、每次分支、每次求和
 * 都是引擎真求值——不是预写诗句的打印，而是计算与诗交织。
 *
 * 关键词别名成诗词（ADR 0022），无括号单参调用用 apply 形（ADR 0027）。canonicalize 归一回
 * 规范关键词 → 诗体版 ≡ 规范版（结构一致 Core IR）。客户端浏览器内 TS 引擎，即时可验。
 * 三首均为原创望月短诗（公有领域）。
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

/** 「夜深→整首诗」的一个样本：入参值 + 算出的完整诗 + 那一段背后的计算说明。 */
export interface PoemSample {
  /** 入参值（第几更 / 夜深几许）。 */
  input: number;
  /** 该夜深算出的整首诗（引擎真求值结果，逐字一致，CI 锁定）。 */
  woven: string;
  /** 这一遍背后「在算什么」的本地化短说明（trace 展示用，非诗本身）。 */
  computed: string;
}

/** 一首「诗即代码」的完整 demo 配置。 */
export interface PoemConfig {
  /** 诗名（展示用）。 */
  title: string;
  /** 题解 / 主题（展示用）。 */
  attribution: string;
  /** 叠加诗词别名的 Lexicon。 */
  lexicon: Lexicon;
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

// ── ZH — 望月（原创连贯诗，公有领域）─────────────────────────────────────────
const POEM_ZH: PoemConfig = {
  title: '望月',
  attribution: '一首会计算的望月诗 · 上句是诗，下句是算',
  lexicon: { ...ZH_CN, id: 'wangyue-zh', name: '望月（中文）', aliases: {
    [K.MODULE_DECL]: ['夜'], [K.FUNC_TO]: ['吟'], [K.FUNC_GIVEN]: ['更'],
    [K.LET]: ['拾'], [K.BE]: ['为'], [K.RETURN]: ['诵'],
    [K.MATCH]: ['观'], [K.WHEN]: ['逢'], [K.PLUS]: ['添'], [K.APPLY]: ['续'],
  } } as Lexicon,
  source: `夜 深。

吟 月相 更 时：
  观 时：
    逢 1，诵 「新月隐，海上潮声黑，」。
    逢 2，诵 「半轮斜，浅水梦初回，」。
    逢 3，诵 「满月升，浪卷欲腾飞，」。

吟 怀 更 时：
  拾 星 为 List.range(1, 时 添 1)。
  拾 辉 为 List.sum(星)。
  观 辉：
    逢 1，诵 「举头一点光相随。」。
    逢 3，诵 「举头三星共月辉。」。
    逢 6，诵 「满天星河照人归。」。

吟 望月 更 时：
  诵 月相(时) 添 续 怀 设为 时。`,
  canonical: `模块 深。

规则 月相 给定 时：
  匹配于 时：
    当 1，返回 「新月隐，海上潮声黑，」。
    当 2，返回 「半轮斜，浅水梦初回，」。
    当 3，返回 「满月升，浪卷欲腾飞，」。

规则 怀 给定 时：
  令 星 定义为 List.range(1, 时 加上 1)。
  令 辉 定义为 List.sum(星)。
  匹配于 辉：
    当 1，返回 「举头一点光相随。」。
    当 3，返回 「举头三星共月辉。」。
    当 6，返回 「满天星河照人归。」。

规则 望月 给定 时：
  返回 月相(时) 加上 应用 怀 设为 时。`,
  entry: '望月', param: '时',
  samples: [
    { input: 1, woven: '新月隐，海上潮声黑，举头一点光相随。', computed: '怀(1)：List.sum(List.range(1,2)) = 1 → 「举头一点光相随」' },
    { input: 2, woven: '半轮斜，浅水梦初回，举头三星共月辉。', computed: '怀(2)：List.sum(List.range(1,3)) = 1+2 = 3 → 「举头三星共月辉」' },
    { input: 3, woven: '满月升，浪卷欲腾飞，满天星河照人归。', computed: '怀(3)：List.sum(List.range(1,4)) = 1+2+3 = 6 → 「满天星河照人归」' },
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

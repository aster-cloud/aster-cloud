// 🃏 德州扑克摊牌引擎 fun-demo 数据 + 逻辑。
//
// 又一个不太正经的彩蛋（姊妹篇=猫咪心情引擎 cat-mood.ts）：用「扑克领域」的术语
// 写一条决定**摊牌赢家**的规则，浏览器引擎注入这套扑克词汇后真编译真执行，决策驱动
// 一段牌桌动画——给赢家颁奖杯。证明「领域词汇」可以是任何领域，底层和信贷 demo 同一套
// 可证明引擎。纯客户端、无网络、无 WASM、CSP 友好。
//
// 设计要点：
//  1. **手牌强度评估在 JS**（dealRandomBoard / evaluateBest5）：9 张牌（2 玩家各 2 +
//     公共 5），各取最佳 5 张算一个**整数强度分** rank（越大越强）。把组合学留给 JS，
//     让 CNL 规则只做「比两个分数」——稳落在已验证的 CNL 特性内（If / at least /
//     Return，与 cat-mood 一致），不碰引擎不支持的复杂逻辑。
//  2. 规则用扑克术语（localized）+ 对应语言 CNL 关键词；compile({lexicon,domain,
//     tenantId}) 经 registerCustom 注入翻译成 canonical IR。
//  3. eval 输入用 **canonical 字段名**（p1strength/p2strength）。
//  4. 避 or/或/oder（域翻译下落空）→ 嵌套 If；德文标识符避 ue/ae/oe。

import {
  vocabularyRegistry,
  EN_US, ZH_CN, DE_DE,
  type Lexicon,
} from '@/lib/aster-lexicon';
import {
  assembleDomainVocabularyFromLinks,
  type TermLikeRow,
} from '@/lib/domain-vocabulary-assemble';

export type DemoLocale = 'en' | 'zh' | 'de';

export function toDemoLocale(locale: string): DemoLocale {
  const l = locale.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('de')) return 'de';
  return 'en';
}

const LEXICONS: Record<DemoLocale, Lexicon> = { en: EN_US, zh: ZH_CN, de: DE_DE };
const LOCALE_TAGS: Record<DemoLocale, string> = { en: 'en-US', zh: 'zh-CN', de: 'de-DE' };

export const POKER_DEMO_TENANT = 'poker-showdown-anon';
export const POKER_DOMAIN = 'poker.showdown';

/* ── 牌型 / 发牌（纯 JS） ─────────────────────────────────────────── */

/** 花色：黑桃/红心/方块/梅花。 */
export type Suit = 's' | 'h' | 'd' | 'c';
/** 点数 2..14（J=11 Q=12 K=13 A=14）。 */
export type Rank = number;
export interface Card { rank: Rank; suit: Suit; }

const SUITS: Suit[] = ['s', 'h', 'd', 'c'];

/** 标准扑克手牌类别（9 类，category 越大越强）。 */
export type HandCategory =
  | 'high' | 'pair' | 'twoPair' | 'trips' | 'straight'
  | 'flush' | 'fullHouse' | 'quads' | 'straightFlush';

export const HAND_CATEGORY_ORDER: HandCategory[] = [
  'high', 'pair', 'twoPair', 'trips', 'straight',
  'flush', 'fullHouse', 'quads', 'straightFlush',
];

export interface HandValue {
  category: HandCategory;
  /** 单调整数强度分：category 权重 + 5 张关键牌的字典序 tiebreak。越大越强。 */
  score: number;
  /** 决定这手牌的最佳 5 张（展示/高亮用）。 */
  cards: Card[];
}

const RANK_LABEL: Record<number, string> = {
  11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
export function rankLabel(r: Rank): string {
  return RANK_LABEL[r] ?? String(r);
}
export const SUIT_GLYPH: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_IS_RED: Record<Suit, boolean> = { s: false, h: true, d: true, c: false };

/** 5 张牌求手型值。score 是把 [category, kicker1..5] 编码成单调整数。 */
function rank5(cards: Card[]): HandValue {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  // 直顺检测（含 A-2-3-4-5 的「轮子」，A 当 1）。
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // wheel
  }

  // 点数计数（用于对子/三条/葫芦/四条）。
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // 按 (出现次数, 点数) 降序——同次数比点数。
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pattern = grouped.map((g) => g[1]).join(''); // e.g. "32"=葫芦, "41"=四条

  let category: HandCategory;
  if (straightHigh && isFlush) category = 'straightFlush';
  else if (pattern.startsWith('4')) category = 'quads';
  else if (pattern === '32') category = 'fullHouse';
  else if (isFlush) category = 'flush';
  else if (straightHigh) category = 'straight';
  else if (pattern.startsWith('3')) category = 'trips';
  else if (pattern === '221') category = 'twoPair';
  else if (pattern.startsWith('2')) category = 'pair';
  else category = 'high';

  // tiebreak 关键牌：按分组次序展开（四条的 4 张在前、其 kicker 在后…），直顺用 high。
  const tiebreak = straightHigh
    ? [straightHigh]
    : grouped.flatMap(([r, n]) => Array(n).fill(r));
  // 编码：category 占高位，5 个 tiebreak 各占 4 bit（点数 ≤14 < 16）。
  const catIdx = HAND_CATEGORY_ORDER.indexOf(category);
  let score = catIdx;
  for (let i = 0; i < 5; i++) score = score * 16 + (tiebreak[i] ?? 0);

  return { category, score, cards: [...cards].sort((a, b) => b.rank - a.rank) };
}

/** 从 7 张（2 手 + 5 公共）选最佳 5 张。C(7,5)=21 组合，全枚举。 */
export function evaluateBest5(seven: Card[]): HandValue {
  let best: HandValue | null = null;
  const n = seven.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const v = rank5([seven[a], seven[b], seven[c], seven[d], seven[e]]);
            if (!best || v.score > best.score) best = v;
          }
  return best!;
}

export interface PokerBoard {
  player1: [Card, Card];
  player2: [Card, Card];
  community: [Card, Card, Card, Card, Card];
}

export interface PokerOutcome {
  board: PokerBoard;
  p1: HandValue;
  p2: HandValue;
  /** 1 / 2 / 0(平局)。 */
  winner: 1 | 2 | 0;
}

/**
 * 随机发一局（确定性：传入 rng 以便测试/回放）。default Math.random 仅 UI 端用。
 * 发 9 张互不重复：玩家各 2 + 公共 5。
 */
export function dealRandomBoard(rng: () => number = Math.random): PokerBoard {
  const deck: Card[] = [];
  for (let r = 2; r <= 14; r++) for (const s of SUITS) deck.push({ rank: r, suit: s });
  // Fisher-Yates 取前 9 张。
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const nine = deck.slice(0, 9);
  return {
    player1: [nine[0], nine[1]],
    player2: [nine[2], nine[3]],
    community: [nine[4], nine[5], nine[6], nine[7], nine[8]],
  };
}

/** 评估一局（不经引擎，确定性参照 + UI 兜底）。 */
export function evaluateBoard(board: PokerBoard): PokerOutcome {
  const p1 = evaluateBest5([...board.player1, ...board.community]);
  const p2 = evaluateBest5([...board.player2, ...board.community]);
  const winner: 1 | 2 | 0 = p1.score > p2.score ? 1 : p2.score > p1.score ? 2 : 0;
  return { board, p1, p2, winner };
}

/* ── 扑克领域词汇 + CNL 规则 ─────────────────────────────────────── */

interface PokerTerm {
  kind: 'struct' | 'field';
  canonical: string;
  parent?: string;
  localized: Record<DemoLocale, string>;
}

// de localized 避 ue/ae/oe（canonicalizer 转 ü/ä/ö 毁 eval 键）。
export const POKER_TERMS: PokerTerm[] = [
  { kind: 'struct', canonical: 'Showdown', localized: { en: 'Showdown', zh: '摊牌', de: 'Showdown' } },
  { kind: 'field', canonical: 'p1strength', parent: 'Showdown', localized: { en: 'playerOneStrength', zh: '一号玩家牌力', de: 'spielerEinsKraft' } },
  { kind: 'field', canonical: 'p2strength', parent: 'Showdown', localized: { en: 'playerTwoStrength', zh: '二号玩家牌力', de: 'spielerZweiKraft' } },
];

export interface PokerRule {
  source: string;
  ruleName: string;
  paramName: string;
}

/** 决策结果（canonical 字符串，跨语言不变；动画/文案据此分支）。 */
export type PokerVerdict = 'player1' | 'player2' | 'tie';

export const POKER_RULES: Record<DemoLocale, PokerRule> = {
  // 注意：规则名/参数名**不得**与域 struct 术语（Showdown/摊牌）同形，否则
  // canonicalizer 会把它当词汇 token 消费 → "Expected identifier" 解析失败
  // （cat-mood 同理：struct Kitty、rule mood、param moggy 全不相交）。故 rule=decide。
  en: {
    ruleName: 'decide', paramName: 'felt',
    source: `Module poker.table.

Define Showdown has
  playerOneStrength as Int,
  playerTwoStrength as Int.

Rule decide given felt as Showdown, produce Text:
  If felt.playerOneStrength greater than felt.playerTwoStrength:
    Return "player1".
  Otherwise:
    If felt.playerTwoStrength greater than felt.playerOneStrength:
      Return "player2".
    Otherwise:
      Return "tie".
`,
  },
  zh: {
    ruleName: '裁决', paramName: '台面',
    source: `模块 扑克.牌桌。

定义 摊牌 包含
  一号玩家牌力 作为 整数，
  二号玩家牌力 作为 整数。

规则 裁决 给定 台面 作为 摊牌 产出 文本：
  如果 台面.一号玩家牌力 大于 台面.二号玩家牌力：
    返回 "player1"。
  否则：
    如果 台面.二号玩家牌力 大于 台面.一号玩家牌力：
      返回 "player2"。
    否则：
      返回 "tie"。
`,
  },
  de: {
    ruleName: 'entscheide', paramName: 'filz',
    source: `Modul poker.tisch.

Definiere Showdown hat
  spielerEinsKraft als Ganzzahl,
  spielerZweiKraft als Ganzzahl.

Regel entscheide gegeben filz als Showdown liefert Text:
  wenn filz.spielerEinsKraft größer als filz.spielerZweiKraft:
    gib zurück "player1".
  sonst:
    wenn filz.spielerZweiKraft größer als filz.spielerEinsKraft:
      gib zurück "player2".
    sonst:
      gib zurück "tie".
`,
  },
};

/** 注入扑克词汇到引擎，返回当前语言的 registry domain key。 */
export function registerPokerVocab(loc: DemoLocale): string {
  const localeTag = LOCALE_TAGS[loc];
  const key = `${POKER_DOMAIN}-${loc}`;
  const rows: TermLikeRow[] = POKER_TERMS.map((t, i) => ({
    domainTermId: `${key}-${i}`,
    domain: key,
    locale: localeTag,
    kind: t.kind,
    canonical: t.canonical,
    localized: t.localized[loc],
    parentCanonical: t.parent ?? null,
  }));
  vocabularyRegistry.registerCustom(POKER_DEMO_TENANT, assembleDomainVocabularyFromLinks(rows, { domain: key, locale: localeTag, name: key }));
  return key;
}

export function pokerLexiconFor(loc: DemoLocale): Lexicon {
  return LEXICONS[loc];
}

/** 当前语言规则里的领域术语（高亮用）。 */
export function pokerVocabTerms(loc: DemoLocale): string[] {
  return POKER_TERMS.map((t) => t.localized[loc]);
}

/** 确定性镜像：按牌力分判赢家（与引擎一致性参照 / 兜底）。 */
export function pokerVerdictOf(p1strength: number, p2strength: number): PokerVerdict {
  if (p1strength > p2strength) return 'player1';
  if (p2strength > p1strength) return 'player2';
  return 'tie';
}

// 🃏 德州扑克摊牌引擎：纯 CNL 牌型判定的契约测试（姊妹篇=cat-mood.compile.test.ts）。
//
// 证明三语**纯 CNL** 规则都能 compile 到 Core IR 且 evaluate 出正确赢家——手牌强度评估
// 全在 CNL（best-5-of-7 via List.combinations），不靠 JS 算分。同时保留 JS 评估器
// （evaluateBest5）作动画/兜底参照的手型判定测试。

import { describe, it, expect } from 'vitest';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import {
  POKER_RULES,
  pokerLexiconFor, cardsForRule,
  evaluateBest5,
  type Card, type DemoLocale,
} from '@/config/poker';

// 小工具：构造牌。
const C = (rank: number, suit: 's' | 'h' | 'd' | 'c'): Card => ({ rank, suit });

const POKER_MAX_STEPS = 200_000;

describe('poker showdown engine compiles & decides in pure CNL (every language)', () => {
  // 真实手牌场景（7 张 = 2 手 + 5 公共），引擎内部 best-5-of-7 classify 比牌力。
  const flushComm = [C(2, 's'), C(7, 's'), C(13, 's'), C(9, 'h'), C(11, 'd')];
  const pairComm = [C(13, 's'), C(12, 'h'), C(2, 'd'), C(5, 'c'), C(8, 's')];
  const cases: Array<{ name: string; p1: Card[]; p2: Card[]; expect: string }> = [
    // P1 凑同花（5 黑桃）vs P2 高牌
    { name: 'flush>high', p1: [C(5, 's'), C(10, 's'), ...flushComm], p2: [C(3, 'h'), C(4, 'd'), ...flushComm], expect: 'player1' },
    // 对 K vs 对 Q（tiebreak：pair 点数，KK>QQ）
    { name: 'KK>QQ', p1: [C(13, 'h'), C(3, 'c'), ...pairComm], p2: [C(12, 'd'), C(4, 's'), ...pairComm], expect: 'player1' },
    // 同手 → 平局
    { name: 'tie', p1: [C(6, 'h'), C(7, 'd'), ...pairComm], p2: [C(6, 'h'), C(7, 'd'), ...pairComm], expect: 'tie' },
  ];

  (['en', 'zh', 'de'] as DemoLocale[]).forEach((loc) => {
    it(`${loc}: pure-CNL classify compiles + decides best-5-of-7`, () => {
      const rule = POKER_RULES[loc];
      const r = compile(rule.source, { lexicon: pokerLexiconFor(loc) } as Parameters<typeof compile>[1]);
      const errs = ((r as { diagnostics?: { severity?: string }[] }).diagnostics ?? []).filter((d) => d.severity === 'error');
      expect(r.core, `[${loc}] core; diags=${JSON.stringify(errs)}`).toBeTruthy();
      expect(errs.length, `[${loc}] ${JSON.stringify(errs)}`).toBe(0);

      for (const c of cases) {
        const ev = evaluate(r.core!, rule.ruleName, {
          [rule.tableParam]: {
            [rule.p1Field]: cardsForRule(loc, c.p1),
            [rule.p2Field]: cardsForRule(loc, c.p2),
          },
        }, { maxSteps: POKER_MAX_STEPS });
        expect(ev.success, `[${loc}] ${c.name}: ${ev.error ?? ''}`).toBe(true);
        expect(String(ev.value), `[${loc}] ${c.name}`).toBe(c.expect);
      }
    });
  });
});

describe('JS hand evaluator (evaluateBest5)', () => {
  it('ranks a flush above a pair', () => {
    const flush = evaluateBest5([
      C(2, 's'), C(7, 's'), C(9, 's'), C(11, 's'), C(13, 's'), C(3, 'd'), C(4, 'h'),
    ]);
    const pair = evaluateBest5([
      C(10, 's'), C(10, 'h'), C(2, 'd'), C(5, 'c'), C(8, 's'), C(3, 'd'), C(4, 'h'),
    ]);
    expect(flush.category).toBe('flush');
    expect(pair.category).toBe('pair');
    expect(flush.score).toBeGreaterThan(pair.score);
  });

  it('detects a straight (incl. wheel A-2-3-4-5)', () => {
    const wheel = evaluateBest5([
      C(14, 's'), C(2, 'h'), C(3, 'd'), C(4, 'c'), C(5, 's'), C(13, 'd'), C(9, 'h'),
    ]);
    expect(wheel.category).toBe('straight');
  });

  it('detects four of a kind over a full house', () => {
    const quads = evaluateBest5([
      C(9, 's'), C(9, 'h'), C(9, 'd'), C(9, 'c'), C(2, 's'), C(3, 'd'), C(4, 'h'),
    ]);
    const boat = evaluateBest5([
      C(8, 's'), C(8, 'h'), C(8, 'd'), C(3, 'c'), C(3, 's'), C(2, 'd'), C(5, 'h'),
    ]);
    expect(quads.category).toBe('quads');
    expect(boat.category).toBe('fullHouse');
    expect(quads.score).toBeGreaterThan(boat.score);
  });
});

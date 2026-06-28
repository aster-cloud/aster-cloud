// 🃏 德州扑克摊牌引擎：规则真编译 + 真执行的契约测试（姊妹篇=cat-mood.compile.test.ts）。
//
// 证明扑克领域词汇注入后，三语规则都能 compile 到 Core IR 且 evaluate 出正确赢家；
// 同时校验 JS 手牌评估器（evaluateBest5）的手型判定与引擎判赢一致。

import { describe, it, expect } from 'vitest';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import {
  POKER_RULES, POKER_DEMO_TENANT,
  registerPokerVocab, pokerLexiconFor, pokerVerdictOf,
  evaluateBest5,
  type Card, type DemoLocale,
} from '@/config/poker';

// 小工具：构造牌。
const C = (rank: number, suit: 's' | 'h' | 'd' | 'c'): Card => ({ rank, suit });

describe('poker showdown engine compiles & runs in every language', () => {
  (['en', 'zh', 'de'] as DemoLocale[]).forEach((loc) => {
    it(`${loc}: showdown rule compiles + decides winner by strength`, () => {
      const domainKey = registerPokerVocab(loc);
      const rule = POKER_RULES[loc];
      const r = compile(rule.source, {
        lexicon: pokerLexiconFor(loc), domain: domainKey, tenantId: POKER_DEMO_TENANT,
      } as Parameters<typeof compile>[1]);
      const errs = ((r as { diagnostics?: { severity?: string }[] }).diagnostics ?? []).filter((d) => d.severity === 'error');
      expect(r.core, `[${loc}] core; diags=${JSON.stringify(errs)}`).toBeTruthy();
      expect(errs.length, `[${loc}] ${JSON.stringify(errs)}`).toBe(0);

      const cases: Array<{ p1: number; p2: number; expect: string }> = [
        { p1: 5000, p2: 1200, expect: 'player1' },
        { p1: 800, p2: 4200, expect: 'player2' },
        { p1: 3333, p2: 3333, expect: 'tie' },
      ];
      for (const c of cases) {
        const ev = evaluate(r.core!, rule.ruleName, {
          [rule.paramName]: { p1strength: c.p1, p2strength: c.p2 },
        });
        expect(ev.success, `[${loc}] ${c.expect}: ${ev.error ?? ''}`).toBe(true);
        expect(String(ev.value), `[${loc}] engine`).toBe(c.expect);
        expect(pokerVerdictOf(c.p1, c.p2), `[${loc}] mirror`).toBe(c.expect);
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

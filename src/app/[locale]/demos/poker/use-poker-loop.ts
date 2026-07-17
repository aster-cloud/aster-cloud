'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import {
  POKER_RULES,
  pokerLexiconFor, pokerVerdictOf, cardsForRule,
  dealRandomBoard, evaluateBoard,
  type DemoLocale, type PokerBoard, type HandValue, type PokerVerdict,
} from '@/config/poker';

// 客户端 eval 步数上限：纯 CNL best-5-of-7 = 21 组合×classify ~数万步（<6ms，有界）。
// 默认 10000 不够；上调到 200000（仅本 demo 受信场景，引擎默认闸门不变）。
const POKER_MAX_STEPS = 200_000;

/**
 * 德州扑克摊牌牌桌的自动往复循环。
 *
 * 一手牌的拍子（phase）：
 *   deal   —— 发 9 张牌（2 玩家各 2 + 公共 5），牌背朝上飞入各自位置
 *   reveal —— 依次翻开（先公共后手牌），观众看清牌面
 *   judge  —— 浏览器引擎注入扑克词汇、真编译真执行 showdown 规则判赢家
 *   award  —— 给赢家颁奖杯（升起 + 高亮赢家手牌）
 *   则下一手（清桌）从 deal 重来——随机往复，无需交互。
 *
 * 决策来自**引擎**（compile+evaluate showdown 规则），手牌强度由 JS evaluateBoard
 * 算出后作为引擎输入；引擎结果与 JS 镜像 pokerVerdictOf 一致性兜底。
 */

export type PokerPhase = 'deal' | 'reveal' | 'judge' | 'award';

export interface PokerHandState {
  board: PokerBoard;
  p1: HandValue;
  p2: HandValue;
  /** 引擎判定的赢家（1/2/0）。 */
  winner: 1 | 2 | 0;
  /** 当前拍。 */
  phase: PokerPhase;
  /** 已翻开的牌数（reveal 期递增：先 5 张公共，再 2+2 手牌 = 9）。 */
  revealed: number;
  /** 单调递增的手牌序号（驱动 React key 让每手干净重置）。 */
  handId: number;
}

const REVEAL_STEP_MS = 320;   // 每张翻牌间隔
const DEAL_MS = 700;          // 发牌飞入
const JUDGE_MS = 900;         // 判定停顿（让"引擎在算"可感知）
const AWARD_MS = 3200;        // 颁奖杯展示
const TOTAL_CARDS = 9;

/** verdict 字符串 → winner 序号。 */
function verdictToWinner(v: string): 1 | 2 | 0 {
  if (v === 'player1') return 1;
  if (v === 'player2') return 2;
  return 0;
}

export function usePokerLoop(loc: DemoLocale): {
  hand: PokerHandState | null;
  paused: boolean;
  togglePause: () => void;
  dealNext: () => void;
} {
  const [hand, setHand] = useState<PokerHandState | null>(null);
  const [paused, setPaused] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pausedRef = useRef(false);
  const handIdRef = useRef(0);

  // 编译纯 CNL 牌型判定规则一次（无域词汇注入——CNL 用 canonical List.* + 本地化字段名）；
  // loc 变化时重编。
  const coreRef = useRef<ReturnType<typeof compile>['core'] | null>(null);
  useEffect(() => {
    const r = compile(POKER_RULES[loc].source, {
      lexicon: pokerLexiconFor(loc),
    } as Parameters<typeof compile>[1]);
    coreRef.current = r.core ?? null;
  }, [loc]);

  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // 用引擎判赢家：把两玩家各 7 张牌（2 手 + 5 公共）喂给纯 CNL decide 规则，引擎内部
  // best-5-of-7 classify 算牌力比大小。失败兜底 JS 镜像（按 evaluateBoard 的 score）。
  const judge = useCallback((board: PokerBoard, p1Score: number, p2Score: number): 1 | 2 | 0 => {
    const core = coreRef.current;
    const rule = POKER_RULES[loc];
    if (core) {
      const p1seven = [...board.player1, ...board.community];
      const p2seven = [...board.player2, ...board.community];
      const ev = evaluate(core, rule.ruleName, {
        [rule.tableParam]: {
          [rule.p1Field]: cardsForRule(loc, p1seven),
          [rule.p2Field]: cardsForRule(loc, p2seven),
        },
      }, { maxSteps: POKER_MAX_STEPS });
      if (ev.success) return verdictToWinner(String(ev.value) as PokerVerdict);
    }
    return verdictToWinner(pokerVerdictOf(p1Score, p2Score));
  }, [loc]);

  // 跑一手：deal → reveal(逐张) → judge → award → 下一手。
  const playHand = useCallback(() => {
    if (pausedRef.current) return;
    clearAll();
    const board = dealRandomBoard();
    const outcome = evaluateBoard(board);          // JS 算手牌强度（作引擎输入 + 兜底）
    const id = ++handIdRef.current;

    // deal：牌背飞入
    setHand({ board, p1: outcome.p1, p2: outcome.p2, winner: 0, phase: 'deal', revealed: 0, handId: id });

    after(DEAL_MS, () => {
      if (pausedRef.current) return;
      // reveal：逐张翻开
      setHand((h) => h && { ...h, phase: 'reveal' });
      let n = 0;
      const revealNext = () => {
        if (pausedRef.current) return;
        n += 1;
        setHand((h) => h && { ...h, revealed: n });
        if (n < TOTAL_CARDS) after(REVEAL_STEP_MS, revealNext);
        else {
          // judge：引擎判定
          after(JUDGE_MS, () => {
            if (pausedRef.current) return;
            const winner = judge(board, outcome.p1.score, outcome.p2.score);
            setHand((h) => h && { ...h, phase: 'judge', winner });
            // award：颁奖杯
            after(260, () => {
              if (pausedRef.current) return;
              setHand((h) => h && { ...h, phase: 'award' });
              // 递归自引用：award 结束的 timer 回调再调用 playHand。deps=[after, clearAll, judge]（稳定）
              // 故引用不会变旧，且仅在 timer 触发时（playHand 已赋值后）执行，无 TDZ 风险——往复循环的固有递归。
              // eslint-disable-next-line react-hooks/immutability
              after(AWARD_MS, () => { if (!pausedRef.current) playHand(); });
            });
          });
        }
      };
      after(REVEAL_STEP_MS, revealNext);
    });
  }, [after, clearAll, judge]);

  // 启动 + 卸载清理。
  useEffect(() => {
    pausedRef.current = false;
    after(500, playHand);
    return clearAll;
    // playHand 依赖 loc（经 judge）；loc 改变时重启循环。
  }, [playHand, after, clearAll]);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      pausedRef.current = next;
      if (!next) {
        // 恢复：从下一手开始
        clearAll();
        after(200, playHand);
      } else {
        clearAll();
      }
      return next;
    });
  }, [after, clearAll, playHand]);

  const dealNext = useCallback(() => {
    if (pausedRef.current) {
      // 暂停态下手动发一手（单步）
      clearAll();
      playHand();
    }
  }, [clearAll, playHand]);

  return { hand, paused, togglePause, dealNext };
}

'use client';

import type { CSSProperties } from 'react';
import {
  rankLabel, SUIT_GLYPH, SUIT_IS_RED,
  type Card, type HandCategory,
} from '@/config/poker';
import type { PokerHandState } from './use-poker-loop';
import { cn } from '@/components/ui';

/**
 * 2.5D 牌桌场景：纯 SVG/CSS（无 WebGL/WASM，CSP 友好）。椭圆绿呢牌桌（径向渐变 +
 * 倒影），上下两个玩家席（各 2 张手牌）、中央公共 5 张牌。牌用 CSS 3D flip（牌背→牌面）
 * 逐张翻开；判定后赢家席升起奖杯并高亮其最佳手牌牌型标签。整桌由 use-poker-loop 自动
 * 往复驱动，无需交互。
 */

/** 单张扑克牌（CSS 3D 翻面）。faceUp=false 显示牌背。 */
function PlayingCard({
  card, faceUp, highlight, dim, style,
}: {
  card: Card;
  faceUp: boolean;
  highlight?: boolean;
  dim?: boolean;
  style?: CSSProperties;
}) {
  const red = SUIT_IS_RED[card.suit];
  return (
    <div
      className={cn('poker-card', faceUp && 'is-up', highlight && 'is-win', dim && 'is-dim')}
      style={style}
      aria-hidden
    >
      <div className="poker-card-inner">
        {/* 牌背 */}
        <div className="poker-card-back">
          <div className="poker-card-back-pattern" />
        </div>
        {/* 牌面 */}
        <div className={cn('poker-card-face', red ? 'poker-red' : 'poker-black')}>
          <span className="poker-card-corner tl">
            {rankLabel(card.rank)}<br />{SUIT_GLYPH[card.suit]}
          </span>
          <span className="poker-card-pip">{SUIT_GLYPH[card.suit]}</span>
          <span className="poker-card-corner br">
            {rankLabel(card.rank)}<br />{SUIT_GLYPH[card.suit]}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 简笔奖杯（升起动画由父 class 控制）。 */
function Trophy({ show, className }: { show: boolean; className?: string }) {
  return (
    <div className={cn('poker-trophy', show && 'is-show', className)} aria-hidden>
      <svg viewBox="0 0 64 72" width="56" height="63">
        <defs>
          <linearGradient id="trophy-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="45%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#b45309" />
          </linearGradient>
        </defs>
        {/* 杯身 */}
        <path d="M18 8 H46 V22 C46 34 40 40 32 40 C24 40 18 34 18 22 Z" fill="url(#trophy-gold)" stroke="#92400e" strokeWidth="1.5" />
        {/* 双耳 */}
        <path d="M18 12 C8 12 8 26 18 26" fill="none" stroke="#d97706" strokeWidth="3" />
        <path d="M46 12 C56 12 56 26 46 26" fill="none" stroke="#d97706" strokeWidth="3" />
        {/* 杯柱 + 底座 */}
        <rect x="29" y="40" width="6" height="10" fill="#b45309" />
        <rect x="22" y="50" width="20" height="5" rx="1.5" fill="#92400e" />
        <rect x="18" y="55" width="28" height="6" rx="2" fill="url(#trophy-gold)" stroke="#92400e" strokeWidth="1" />
        {/* 星 */}
        <path d="M32 16 l2.2 4.5 5 .7 -3.6 3.5 .9 5 -4.5 -2.4 -4.5 2.4 .9 -5 -3.6 -3.5 5 -.7 Z" fill="#fffbeb" />
      </svg>
    </div>
  );
}

/** 玩家席（标签 + 2 手牌 + 牌型 + 奖杯/赢家高亮）。 */
function Seat({
  label, cards, faceUpCount, isWinner, decided, handLabel, category, side,
}: {
  label: string;
  cards: [Card, Card];
  faceUpCount: number;     // 这两张里已翻开几张
  isWinner: boolean;
  decided: boolean;        // 是否已判定（award 阶段）
  handLabel: string;       // 牌型本地化名（如「同花」）
  category: HandCategory;
  side: 'top' | 'bottom';
}) {
  return (
    <div className={cn('poker-seat', `poker-seat-${side}`, decided && (isWinner ? 'is-winner' : 'is-loser'))}>
      <div className="poker-seat-label">
        {label}
        {decided && isWinner && <span className="poker-seat-crown">👑</span>}
      </div>
      <div className="poker-seat-cards">
        {cards.map((c, i) => (
          <PlayingCard
            key={i}
            card={c}
            faceUp={i < faceUpCount}
            highlight={decided && isWinner}
            dim={decided && !isWinner}
            style={{ ['--card-i' as string]: i }}
          />
        ))}
      </div>
      {decided && (
        <div className={cn('poker-hand-label', `poker-cat-${category}`)}>{handLabel}</div>
      )}
      <Trophy show={decided && isWinner} />
    </div>
  );
}

export interface PokerTableSceneProps {
  hand: PokerHandState | null;
  /** 玩家席名（本地化）。 */
  playerLabels: [string, string];
  /** 牌型 category → 本地化名。 */
  categoryLabel: (c: HandCategory) => string;
  /** 平局文案。 */
  tieLabel: string;
}

/**
 * 翻牌顺序：reveal 期先翻 5 张公共（revealed 1..5），再翻 P1 两张（6..7）、P2 两张（8..9）。
 * 据 revealed 计算各区已翻开张数。
 */
function faceUpCounts(revealed: number, phase: PokerHandState['phase']) {
  if (phase === 'deal') return { community: 0, p1: 0, p2: 0 };
  // judge/award 阶段全开
  if (phase === 'judge' || phase === 'award') return { community: 5, p1: 2, p2: 2 };
  return {
    community: Math.min(5, revealed),
    p1: Math.max(0, Math.min(2, revealed - 5)),
    p2: Math.max(0, Math.min(2, revealed - 7)),
  };
}

export function PokerTableScene({ hand, playerLabels, categoryLabel, tieLabel }: PokerTableSceneProps) {
  const decided = hand?.phase === 'award';
  const counts = hand ? faceUpCounts(hand.revealed, hand.phase) : { community: 0, p1: 0, p2: 0 };

  return (
    <div className="poker-stage" key={hand?.handId ?? 'init'}>
      <div className="poker-felt">
        {/* 上席（玩家 2） */}
        {hand && (
          <Seat
            side="top"
            label={playerLabels[1]}
            cards={hand.board.player2}
            faceUpCount={counts.p2}
            isWinner={hand.winner === 2}
            decided={decided}
            category={hand.p2.category}
            handLabel={categoryLabel(hand.p2.category)}
          />
        )}

        {/* 公共牌区 */}
        <div className="poker-community">
          {hand?.board.community.map((c, i) => (
            <PlayingCard
              key={i}
              card={c}
              faceUp={i < counts.community}
              style={{ ['--card-i' as string]: i }}
            />
          ))}
          {/* 判定横幅 */}
          {decided && hand.winner === 0 && (
            <div className="poker-tie-banner">{tieLabel}</div>
          )}
        </div>

        {/* 下席（玩家 1） */}
        {hand && (
          <Seat
            side="bottom"
            label={playerLabels[0]}
            cards={hand.board.player1}
            faceUpCount={counts.p1}
            isWinner={hand.winner === 1}
            decided={decided}
            category={hand.p1.category}
            handLabel={categoryLabel(hand.p1.category)}
          />
        )}
      </div>
    </div>
  );
}

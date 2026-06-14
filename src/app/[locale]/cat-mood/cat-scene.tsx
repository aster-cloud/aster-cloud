'use client';

import { useImperativeHandle, forwardRef } from 'react';
import type { CatMood } from '@/config/cat-mood';
import { useCatBehavior } from './use-cat-behavior';

/**
 * 温馨室内阳光间布景 + 一只自主游荡的活猫（插画级 SVG）。
 *
 * 布景（静态 SVG）：墙、窗 + 窗外天空、地板、阳光斑、地毯、饭碗、猫抓柱。
 * 活猫：位置/朝向/姿态由 useCatBehavior 状态机驱动，平时随机游走 + 坐/舔爪/伸懒腰/打盹，
 * 运行规则时走向相关道具摆心情 pose。位移用 CSS transition（walkMs 动态时长）平滑过渡，
 * 朝向用 scaleX 翻转，走路/姿态/微动用 pose class 的 keyframes。
 *
 * 暴露 ref.react(mood)：父组件运行规则后调用，触发心情响应。
 */
export interface CatSceneHandle {
  react: (mood: CatMood) => void;
  reacting: boolean;
}

export const CatScene = forwardRef<CatSceneHandle, { reducedHeight?: boolean }>(function CatScene(_props, ref) {
  const { state, react } = useCatBehavior();
  useImperativeHandle(ref, () => ({ react, reacting: state.reacting }), [react, state.reacting]);

  return (
    <div className="cat-room">
      {/* ── 布景（静态） ── */}
      <svg className="cat-room-bg" viewBox="0 0 400 280" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <linearGradient id="roomWall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbe9d7" /><stop offset="100%" stopColor="#f6dcc2" />
          </linearGradient>
          <linearGradient id="roomFloor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e7c39a" /><stop offset="100%" stopColor="#d8ad7e" />
          </linearGradient>
          <linearGradient id="roomSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfe3ff" /><stop offset="100%" stopColor="#eaf7ff" />
          </linearGradient>
          <radialGradient id="sunPatch" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#ffe9a8" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffe9a8" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 墙 + 地板 */}
        <rect x="0" y="0" width="400" height="186" fill="url(#roomWall)" />
        <rect x="0" y="186" width="400" height="94" fill="url(#roomFloor)" />
        <line x1="0" y1="186" x2="400" y2="186" stroke="#c79a6a" strokeWidth="2" />
        {/* 地板纹理 */}
        <g stroke="#cfa477" strokeWidth="1" opacity="0.5">
          <line x1="60" y1="186" x2="20" y2="280" /><line x1="160" y1="186" x2="140" y2="280" />
          <line x1="260" y1="186" x2="280" y2="280" /><line x1="350" y1="186" x2="380" y2="280" />
        </g>

        {/* 窗户 + 窗外天空 + 云 */}
        <g>
          <rect x="40" y="36" width="120" height="96" rx="6" fill="url(#roomSky)" stroke="#b98a5e" strokeWidth="6" />
          <line x1="100" y1="36" x2="100" y2="132" stroke="#b98a5e" strokeWidth="4" />
          <line x1="40" y1="84" x2="160" y2="84" stroke="#b98a5e" strokeWidth="4" />
          <ellipse cx="72" cy="62" rx="14" ry="7" fill="#fff" opacity="0.9" />
          <ellipse cx="128" cy="104" rx="11" ry="6" fill="#fff" opacity="0.85" />
          <circle cx="138" cy="56" r="9" fill="#ffe27a" />
        </g>

        {/* 阳光斑（窗光投在地板，loaf 道具） */}
        <ellipse className="cat-room-sun" cx="96" cy="214" rx="56" ry="20" fill="url(#sunPatch)" />

        {/* 地毯（judge 中央道具） */}
        <ellipse cx="200" cy="232" rx="78" ry="20" fill="#e88f86" opacity="0.85" />
        <ellipse cx="200" cy="232" rx="60" ry="14" fill="none" stroke="#fff" strokeWidth="2" opacity="0.7" />

        {/* 饭碗（purr 道具，右下） */}
        <g>
          <ellipse cx="312" cy="236" rx="26" ry="9" fill="#7cc4e0" stroke="#4f9ec0" strokeWidth="2" />
          <path d="M289 233 q23 12 46 0" fill="#ffb784" stroke="#e08a4e" strokeWidth="1.5" />
        </g>

        {/* 猫抓柱（布景点缀，右上角） */}
        <g>
          <rect x="350" y="150" width="16" height="80" rx="4" fill="#cdbfae" stroke="#a89884" strokeWidth="2" />
          <rect x="338" y="138" width="40" height="16" rx="4" fill="#e6b86a" stroke="#bd8e44" strokeWidth="2" />
        </g>
      </svg>

      {/* ── 活猫（绝对定位，状态机驱动） ── */}
      <div
        className={`cat-actor cat-pose-${state.pose}${state.reacting ? ' is-reacting' : ''}`}
        style={{
          left: `${state.x}%`,
          top: `${state.y}%`,
          // 走动用线性时长（配合踏步竖直小跳 = 走而非滑）；停留(moveMs=0)瞬时不过渡。
          transition: state.moveMs > 0
            ? `left ${state.moveMs}ms linear, top ${state.moveMs}ms linear`
            : 'none',
          // facing：-1 时水平翻转。
          ['--facing' as string]: String(state.facing),
        }}
      >
        <CatSprite />
      </div>
    </div>
  );
});

/**
 * 猫精灵 SVG——插画级橘猫，所有 pose 共用同一套部件，靠 CSS class 改变姿态/动画。
 * 部件 class：cat-head / cat-body / cat-tail / cat-legs / cat-eyes / cat-happy-eyes /
 * cat-ear-l / cat-ear-r 等，供姿态 keyframes 操控。
 */
function CatSprite() {
  return (
    <svg className="cat-sprite" viewBox="0 0 120 110" aria-hidden>
      <defs>
        <linearGradient id="spriteFur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd9a8" /><stop offset="55%" stopColor="#ffb066" /><stop offset="100%" stopColor="#f59140" />
        </linearGradient>
        <linearGradient id="spriteCream" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fffdf8" /><stop offset="100%" stopColor="#ffeede" />
        </linearGradient>
        <radialGradient id="spriteIris" cx="42%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#b6e36a" /><stop offset="55%" stopColor="#6fae3a" /><stop offset="100%" stopColor="#3c7a2a" />
        </radialGradient>
        <filter id="spriteShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#c97b35" floodOpacity="0.3" />
        </filter>
      </defs>

      {/* 接地阴影（随身体） */}
      <ellipse className="cat-shadow" cx="60" cy="100" rx="34" ry="6" />

      {/* 尾巴 */}
      <g className="cat-tail">
        <path className="cat-fur cat-tail-body" d="M88 86 q26 4 26 -22 q0 -14 -12 -14" />
        <path className="cat-tail-tip" d="M102 50 q-5 -2 -9 1" />
      </g>

      {/* 后/前腿（走路摆动） */}
      <g className="cat-legs">
        <rect className="cat-fur cat-leg cat-leg-bl" x="44" y="84" width="9" height="16" rx="4" />
        <rect className="cat-fur cat-leg cat-leg-br" x="66" y="84" width="9" height="16" rx="4" />
        <rect className="cat-fur cat-leg cat-leg-fl" x="50" y="86" width="8" height="15" rx="4" />
        <rect className="cat-fur cat-leg cat-leg-fr" x="62" y="86" width="8" height="15" rx="4" />
      </g>

      {/* 身体 */}
      <g className="cat-body" filter="url(#spriteShadow)">
        <path className="cat-fur" d="M34 84 q-2 -32 26 -32 q28 0 26 32 q-1 14 -26 14 q-25 0 -26 -14 Z" />
        <path className="cat-belly" d="M48 70 q12 -8 24 0 q3 16 -12 18 q-15 -2 -12 -18 Z" />
        <path className="cat-stripe" d="M40 64 q-2 8 0 16" /><path className="cat-stripe" d="M80 64 q2 8 0 16" />
      </g>

      {/* 头 */}
      <g className="cat-head" filter="url(#spriteShadow)">
        <path className="cat-fur cat-ear cat-ear-l" d="M40 36 Q32 10 56 30 Z" />
        <path className="cat-fur cat-ear cat-ear-r" d="M80 36 Q88 10 64 30 Z" />
        <path className="cat-ear-in" d="M44 32 Q39 18 53 30 Z" /><path className="cat-ear-in" d="M76 32 Q81 18 67 30 Z" />
        <ellipse className="cat-fur cat-face" cx="60" cy="50" rx="30" ry="27" />
        <ellipse className="cat-muzzle" cx="60" cy="58" rx="17" ry="13" />
        <g className="cat-forehead">
          <path d="M60 24 L60 31" /><path d="M53 25 L55 32" /><path d="M67 25 L65 32" />
        </g>
        <ellipse className="cat-blush cat-blush-l" cx="42" cy="58" rx="7" ry="4" />
        <ellipse className="cat-blush cat-blush-r" cx="78" cy="58" rx="7" ry="4" />
        {/* 立体眼 */}
        <g className="cat-eyes">
          <g className="cat-eye-l">
            <ellipse className="cat-eyewhite" cx="50" cy="49" rx="7" ry="9" />
            <ellipse className="cat-iris" cx="50" cy="50" rx="5.5" ry="7.5" />
            <ellipse className="cat-pupil" cx="50" cy="50.5" rx="2.4" ry="5" />
            <circle className="cat-glint" cx="48" cy="46" r="2" />
          </g>
          <g className="cat-eye-r">
            <ellipse className="cat-eyewhite" cx="70" cy="49" rx="7" ry="9" />
            <ellipse className="cat-iris" cx="70" cy="50" rx="5.5" ry="7.5" />
            <ellipse className="cat-pupil" cx="70" cy="50.5" rx="2.4" ry="5" />
            <circle className="cat-glint" cx="68" cy="46" r="2" />
          </g>
        </g>
        {/* 笑眼弧（idle/purr 时显） */}
        <g className="cat-happy-eyes">
          <path className="cat-eye-l" d="M44 50 q6 -7 13 0" /><path className="cat-eye-r" d="M63 50 q6 -7 13 0" />
        </g>
        <path className="cat-nose" d="M56 59 L64 59 L60 63 Z" />
        <path className="cat-mouth" d="M60 63 q-4 5 -8 2 M60 63 q4 5 8 2" />
        <g className="cat-whiskers">
          <path d="M44 58 q-13 -2 -20 -6" /><path d="M44 63 q-13 1 -20 3" />
          <path d="M76 58 q13 -2 20 -6" /><path d="M76 63 q13 1 20 3" />
        </g>
      </g>

      {/* 飘心/音符（purr）、惊叹/毛刺（floof） */}
      <path className="cat-heart" d="M92 30 a4 4 0 0 1 7 0 a4 4 0 0 1 7 0 q0 5 -7 9 q-7 -4 -7 -9 Z" />
      <text className="cat-bang" x="92" y="26">!</text>
      <g className="cat-floof-spikes">
        <path d="M34 44 L24 38" /><path d="M32 62 L20 64" /><path d="M88 44 L98 38" /><path d="M90 62 L102 64" /><path d="M60 18 L60 8" />
      </g>
    </svg>
  );
}

'use client';

import type { CatMood } from '@/config/cat-mood';

/**
 * 5 秒可爱猫动画——由决策心情驱动。插画级 SVG（多层填充 + 渐变 + 阴影 + 毛色花纹），
 * 非简笔。纯 SVG + CSS keyframes（零依赖、CSP/Workers 友好，服务端可渲染）。
 *
 * 画法：橘猫（ginger tabby）渐变毛色 + 白肚兜/口鼻 + 立体大眼（渐变虹膜 + 瞳孔 + 双高光）
 * + 粉内耳 + 腮红 + 肉垫 + 尾纹 + 柔和投影。kawaii：大头小身、超大圆眼、暖色。
 * 四种心情动画：purr 呼噜 / loaf 猫面包 / floof 炸毛 / judge 高冷。
 * key={mood} 强制重挂载，每次运行从头播 5 秒。reduced-motion 退化为静态。
 */
export function CatAnimation({ mood }: { mood: CatMood }) {
  return (
    <div key={mood} className={`cat-stage cat-${mood}`} aria-hidden>
      <svg viewBox="0 0 240 220" className="cat-svg" role="img">
        <defs>
          {/* 身体/头：橘猫毛色渐变（顶亮底暗，体积感） */}
          <linearGradient id="catFur" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffd9a8" />
            <stop offset="55%" stopColor="#ffb066" />
            <stop offset="100%" stopColor="#f59140" />
          </linearGradient>
          {/* 白肚兜/口鼻渐变 */}
          <linearGradient id="catCream" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fffdf8" />
            <stop offset="100%" stopColor="#ffeede" />
          </linearGradient>
          {/* 内耳粉 */}
          <linearGradient id="catEarIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffc2c9" />
            <stop offset="100%" stopColor="#ff9aa6" />
          </linearGradient>
          {/* 眼睛虹膜（琥珀绿，立体） */}
          <radialGradient id="catIris" cx="42%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#b6e36a" />
            <stop offset="55%" stopColor="#6fae3a" />
            <stop offset="100%" stopColor="#3c7a2a" />
          </radialGradient>
          {/* 柔和投影 */}
          <filter id="catShadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#c97b35" floodOpacity="0.28" />
          </filter>
          {/* 阳光斑光晕 */}
          <radialGradient id="catSunG" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffe79a" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffe79a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 地面投影 */}
        <ellipse className="cat-ground" cx="120" cy="196" rx="74" ry="12" />
        {/* 阳光斑（仅 loaf 显） */}
        <ellipse className="cat-sun" cx="120" cy="190" rx="96" ry="22" />

        {/* 尾巴（橘底 + 深色环纹 + 白尖） */}
        <g className="cat-tail">
          <path className="cat-tail-body" d="M176 162 q46 8 46 -38 q0 -26 -22 -26" />
          <path className="cat-tail-stripe" d="M210 104 q8 6 6 16" />
          <path className="cat-tail-stripe" d="M220 124 q8 6 4 18" />
          <path className="cat-tail-tip" d="M200 98 q-8 -4 -14 2" />
        </g>

        {/* 身体（橘渐变 + 白肚兜 + 体侧纹） */}
        <g className="cat-body" filter="url(#catShadow)">
          <path className="cat-fur" d="M62 168 q-4 -56 58 -56 q62 0 58 56 q-2 26 -58 26 q-56 0 -58 -26 Z" />
          <path className="cat-belly" d="M92 132 q28 -14 56 0 q6 30 -28 34 q-34 -4 -28 -34 Z" />
          <path className="cat-stripe" d="M70 138 q-4 12 0 24" />
          <path className="cat-stripe" d="M170 138 q4 12 0 24" />
        </g>
        {/* 前爪（带肉垫） */}
        <g className="cat-paws">
          <ellipse className="cat-fur" cx="96" cy="184" rx="16" ry="11" />
          <ellipse className="cat-fur" cx="144" cy="184" rx="16" ry="11" />
          <ellipse className="cat-pad" cx="96" cy="186" rx="6" ry="4" />
          <ellipse className="cat-pad" cx="144" cy="186" rx="6" ry="4" />
        </g>

        {/* 头 */}
        <g className="cat-head" filter="url(#catShadow)">
          {/* 耳朵（橘外 + 粉内） */}
          <path className="cat-fur cat-ear" d="M74 56 Q60 14 102 46 Z" />
          <path className="cat-fur cat-ear" d="M166 56 Q180 14 138 46 Z" />
          <path className="cat-ear-in" d="M82 50 Q74 26 96 46 Z" />
          <path className="cat-ear-in" d="M158 50 Q166 26 144 46 Z" />

          {/* 脸（橘渐变大圆） */}
          <ellipse className="cat-fur cat-face" cx="120" cy="86" rx="56" ry="50" />
          {/* 白口鼻区 */}
          <ellipse className="cat-muzzle" cx="120" cy="100" rx="32" ry="24" />
          {/* 额头 M 纹（橘猫标志） */}
          <g className="cat-forehead">
            <path d="M120 44 L120 56" /><path d="M108 46 L112 57" /><path d="M132 46 L128 57" />
          </g>
          {/* 颊侧纹 */}
          <g className="cat-cheekstripe">
            <path d="M70 84 q-12 -2 -18 -6" /><path d="M70 92 q-12 1 -18 4" />
            <path d="M170 84 q12 -2 18 -6" /><path d="M170 92 q12 1 18 4" />
          </g>

          {/* 腮红 */}
          <ellipse className="cat-blush cat-blush-l" cx="84" cy="100" rx="12" ry="7" />
          <ellipse className="cat-blush cat-blush-r" cx="156" cy="100" rx="12" ry="7" />

          {/* 立体大眼：眼白 + 虹膜 + 瞳孔 + 双高光 */}
          <g className="cat-eyes">
            <g className="cat-eye cat-eye-l">
              <ellipse className="cat-eyewhite" cx="98" cy="84" rx="13" ry="16" />
              <ellipse className="cat-iris" cx="98" cy="85" rx="10" ry="13" />
              <ellipse className="cat-pupil" cx="98" cy="86" rx="4.5" ry="9" />
              <circle className="cat-glint cat-glint-a" cx="94" cy="79" r="3.6" />
              <circle className="cat-glint cat-glint-b" cx="101" cy="89" r="1.8" />
            </g>
            <g className="cat-eye cat-eye-r">
              <ellipse className="cat-eyewhite" cx="142" cy="84" rx="13" ry="16" />
              <ellipse className="cat-iris" cx="142" cy="85" rx="10" ry="13" />
              <ellipse className="cat-pupil" cx="142" cy="86" rx="4.5" ry="9" />
              <circle className="cat-glint cat-glint-a" cx="138" cy="79" r="3.6" />
              <circle className="cat-glint cat-glint-b" cx="145" cy="89" r="1.8" />
            </g>
          </g>
          {/* 眯眯笑眼（purr/loaf/judge 时盖在眼上的弧线） */}
          <g className="cat-happy-eyes">
            <path className="cat-eye-l" d="M86 86 q12 -12 24 0" />
            <path className="cat-eye-r" d="M130 86 q12 -12 24 0" />
          </g>

          {/* 鼻 + ω 嘴 */}
          <path className="cat-nose" d="M114 102 L126 102 L120 108 Z" />
          <path className="cat-mouth" d="M120 108 q-6 7 -12 3 M120 108 q6 7 12 3" />
          {/* 胡须 */}
          <g className="cat-whiskers">
            <path d="M88 100 q-20 -3 -30 -8" /><path d="M88 107 q-20 1 -30 4" />
            <path d="M152 100 q20 -3 30 -8" /><path d="M152 107 q20 1 30 4" />
          </g>
        </g>

        {/* 爱心 + 音符（仅 purr 飘） */}
        <path className="cat-heart cat-heart-1" d="M184 62 a6 6 0 0 1 11 0 a6 6 0 0 1 11 0 q0 8 -11 15 q-11 -7 -11 -15 Z" />
        <text className="cat-note cat-note-1" x="196" y="44">♪</text>

        {/* 惊叹 + 毛刺（仅 floof） */}
        <text className="cat-bang" x="188" y="52">!</text>
        <g className="cat-floof-spikes">
          <path d="M66 78 L50 68" /><path d="M62 104 L44 104" /><path d="M68 128 L52 140" />
          <path d="M174 78 L190 68" /><path d="M178 104 L196 104" /><path d="M172 128 L188 140" />
          <path d="M120 30 L120 14" />
        </g>
      </svg>
    </div>
  );
}

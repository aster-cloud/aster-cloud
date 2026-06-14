'use client';

import type { CatMood } from '@/config/cat-mood';

/**
 * 5 秒简笔猫动画——由决策心情驱动。纯 SVG + CSS keyframes（零依赖、CSP/Workers 友好，
 * 服务端可渲染）。四种心情各一套动画：
 *  - purr  呼噜：满足眯眼，飘音符 ♪♪
 *  - loaf  猫面包：阳光下摊平，缓缓呼吸
 *  - floof 炸毛：陌生人来了，毛炸开 + 弓背抖动
 *  - judge 高冷：眯眼审视，尾巴慢摇
 * 用 key={mood} 强制重挂载，每次运行从头播 5 秒。reduced-motion 下退化为静态姿势。
 */
export function CatAnimation({ mood }: { mood: CatMood }) {
  return (
    <div key={mood} className={`cat-stage cat-${mood}`} aria-hidden>
      <svg viewBox="0 0 200 160" className="cat-svg" role="img">
        {/* 阳光斑（仅 loaf 显） */}
        <ellipse className="cat-sun" cx="100" cy="140" rx="70" ry="14" />

        {/* 尾巴 */}
        <path className="cat-tail" d="M150 110 q34 -6 30 -40" />

        {/* 身体 */}
        <ellipse className="cat-body" cx="100" cy="108" rx="46" ry="30" />

        {/* 头 */}
        <g className="cat-head">
          <circle className="cat-face" cx="100" cy="64" r="30" />
          {/* 耳朵 */}
          <path className="cat-ear" d="M78 44 L72 18 L96 38 Z" />
          <path className="cat-ear" d="M122 44 L128 18 L104 38 Z" />
          {/* 眼睛 */}
          <g className="cat-eyes">
            <path className="cat-eye cat-eye-l" d="M86 62 q6 6 12 0" />
            <path className="cat-eye cat-eye-r" d="M102 62 q6 6 12 0" />
          </g>
          {/* 鼻 + 嘴 */}
          <path className="cat-nose" d="M97 72 L103 72 L100 76 Z" />
          <path className="cat-mouth" d="M100 76 q-6 6 -12 3 M100 76 q6 6 12 3" />
          {/* 胡须 */}
          <g className="cat-whiskers">
            <line x1="70" y1="70" x2="44" y2="66" /><line x1="70" y1="74" x2="44" y2="76" />
            <line x1="130" y1="70" x2="156" y2="66" /><line x1="130" y1="74" x2="156" y2="76" />
          </g>
        </g>

        {/* 音符（仅 purr 飘） */}
        <text className="cat-note cat-note-1" x="150" y="50">♪</text>
        <text className="cat-note cat-note-2" x="166" y="38">♫</text>

        {/* 惊叹号（仅 floof 闪） */}
        <text className="cat-bang" x="150" y="44">!</text>

        {/* 炸开的毛刺（仅 floof） */}
        <g className="cat-floof-spikes">
          <path d="M60 96 L48 90" /><path d="M58 112 L44 112" /><path d="M62 126 L50 134" />
          <path d="M140 96 L152 90" /><path d="M142 112 L156 112" /><path d="M138 126 L150 134" />
          <path d="M100 138 L100 152" />
        </g>
      </svg>
    </div>
  );
}

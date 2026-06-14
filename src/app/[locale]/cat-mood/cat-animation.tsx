'use client';

import type { CatMood } from '@/config/cat-mood';

/**
 * 5 秒可爱简笔猫动画（日系卡通/kawaii 画风）——由决策心情驱动。
 * 纯 SVG + CSS keyframes（零依赖、CSP/Workers 友好，服务端可渲染）。
 *
 * kawaii 要点：大头小身、超大圆眼带高光、腮红、圆润耳朵、柔和暖色、Q 弹动效。
 * 四种心情：
 *  - purr  呼噜：眯眯笑眼，飘爱心 + 音符，身子轻弹
 *  - loaf  猫面包：阳光下摊成一块，眯眼，慢呼吸
 *  - floof 炸毛：瞳孔放大 + 惊叹 + 毛刺炸开 + 弹跳
 *  - judge 高冷：半阖眼审视，尾巴慢摇
 * 用 key={mood} 强制重挂载，每次运行从头播 5 秒。reduced-motion 退化为静态。
 */
export function CatAnimation({ mood }: { mood: CatMood }) {
  return (
    <div key={mood} className={`cat-stage cat-${mood}`} aria-hidden>
      <svg viewBox="0 0 220 200" className="cat-svg" role="img">
        <defs>
          {/* 眼睛径向高光渐变 */}
          <radialGradient id="catEyeGrad" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#6b7280" />
            <stop offset="100%" stopColor="#1f2937" />
          </radialGradient>
        </defs>

        {/* 阳光斑（仅 loaf 显） */}
        <ellipse className="cat-sun" cx="110" cy="178" rx="86" ry="16" />

        {/* 尾巴（圆润，末端卷） */}
        <path className="cat-tail" d="M168 150 q40 4 40 -34 q0 -20 -16 -20" />

        {/* 身体（矮胖圆润） */}
        <path className="cat-body" d="M58 150 q0 -44 52 -44 q52 0 52 44 q0 24 -52 24 q-52 0 -52 -24 Z" />
        {/* 前爪 */}
        <ellipse className="cat-paw" cx="88" cy="170" rx="13" ry="9" />
        <ellipse className="cat-paw" cx="132" cy="170" rx="13" ry="9" />

        {/* 头（大圆） */}
        <g className="cat-head">
          {/* 耳朵（圆润三角 + 粉内耳） */}
          <path className="cat-ear" d="M70 50 Q60 14 92 40 Z" />
          <path className="cat-ear" d="M150 50 Q160 14 128 40 Z" />
          <path className="cat-ear-in" d="M76 44 Q72 26 88 40 Z" />
          <path className="cat-ear-in" d="M144 44 Q148 26 132 40 Z" />

          {/* 脸（大圆，略扁） */}
          <ellipse className="cat-face" cx="110" cy="76" rx="50" ry="44" />

          {/* 额头小斑纹（三道，可爱） */}
          <g className="cat-forehead">
            <path d="M110 40 L110 50" /><path d="M100 42 L102 51" /><path d="M120 42 L118 51" />
          </g>

          {/* 腮红 */}
          <ellipse className="cat-blush cat-blush-l" cx="80" cy="88" rx="11" ry="7" />
          <ellipse className="cat-blush cat-blush-r" cx="140" cy="88" rx="11" ry="7" />

          {/* 眼睛（超大圆 + 双高光 = kawaii 灵魂） */}
          <g className="cat-eyes">
            <g className="cat-eye cat-eye-l">
              <ellipse className="cat-eyeball" cx="90" cy="74" rx="11" ry="14" />
              <circle className="cat-glint cat-glint-a" cx="86" cy="69" r="4" />
              <circle className="cat-glint cat-glint-b" cx="93" cy="78" r="2" />
            </g>
            <g className="cat-eye cat-eye-r">
              <ellipse className="cat-eyeball" cx="130" cy="74" rx="11" ry="14" />
              <circle className="cat-glint cat-glint-a" cx="126" cy="69" r="4" />
              <circle className="cat-glint cat-glint-b" cx="133" cy="78" r="2" />
            </g>
          </g>
          {/* 眯眯笑眼（purr/loaf/judge 时盖在眼上的弧线） */}
          <g className="cat-happy-eyes">
            <path className="cat-eye-l" d="M80 76 q10 -10 20 0" />
            <path className="cat-eye-r" d="M120 76 q10 -10 20 0" />
          </g>

          {/* 鼻 + 嘴（小巧 ω 嘴） */}
          <path className="cat-nose" d="M106 88 L114 88 L110 93 Z" />
          <path className="cat-mouth" d="M110 93 q-5 6 -10 2 M110 93 q5 6 10 2" />

          {/* 胡须（细、对称、微翘） */}
          <g className="cat-whiskers">
            <path d="M64 80 q-18 -3 -26 -7" /><path d="M64 86 q-18 1 -26 3" />
            <path d="M156 80 q18 -3 26 -7" /><path d="M156 86 q18 1 26 3" />
          </g>
        </g>

        {/* 爱心 + 音符（仅 purr 飘） */}
        <path className="cat-heart cat-heart-1" d="M168 56 a5 5 0 0 1 9 0 a5 5 0 0 1 9 0 q0 7 -9 13 q-9 -6 -9 -13 Z" />
        <text className="cat-note cat-note-1" x="178" y="40">♪</text>

        {/* 惊叹号（仅 floof 闪） */}
        <text className="cat-bang" x="172" y="48">!</text>

        {/* 炸开的毛刺（仅 floof） */}
        <g className="cat-floof-spikes">
          <path d="M62 70 L48 62" /><path d="M58 92 L42 92" /><path d="M64 112 L50 122" />
          <path d="M158 70 L172 62" /><path d="M162 92 L178 92" /><path d="M156 112 L170 122" />
          <path d="M110 28 L110 14" />
        </g>
      </svg>
    </div>
  );
}

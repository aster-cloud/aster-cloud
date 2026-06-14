'use client';

import { useImperativeHandle, forwardRef } from 'react';
import type { CSSProperties } from 'react';
import type { CatMood } from '@/config/cat-mood';
import { useCatBehavior, type CatState } from './use-cat-behavior';

/**
 * 2.5D 精细猫场景：纯 SVG 矢量插画 + CSS 3D-transform（非 WebGL，零外部资源/零 WASM/
 * CSP 友好）。等距/斜二测视角的温馨室内——倾斜地板（CSS rotateX 透视）铺出纵深，
 * 立墙 + 窗 + 阳光 + 食盆 + 猫爬架都是 SVG 图层；猫是多部件 SVG sprite，始终正对镜头
 * （billboard），脚踩在倾斜地板的投影点上。
 *
 * 复用 useCatBehavior 状态机：state.x/y（0..100 舞台百分比）→ 等距地面坐标 → CSS
 * 平移；state.pose → 猫 sprite 的 CSS class（pose 决定姿态/挤压/弹跳/眯眼等动画）；
 * 走动用 CSS transition（moveMs 控时长，线性=不滑行的踏步感）。
 *
 * 因为不含 WebGL，本组件可正常 SSR；父级仍用 dynamic() 包裹也无妨。
 */

export interface Cat25DHandle {
  react: (mood: CatMood) => void;
}
// 兼容旧别名（父组件曾用 Cat3DHandle 类型名）。
export type Cat3DHandle = Cat25DHandle;

/* ── 舞台坐标 → 地面像素坐标 ──────────────────────────────────────────
 * 舞台 x:0..100（横向）, y:0..100（纵深，越大越靠前）。
 * 关键：墙占舞台 top 0~52%、可见地板 56%~92%。猫的游走带 y∈[78,85]，actor 锚点
 * translate(-50%,-82%) 让脚落在 top + ~6%。为避免猫"滑到墙上"，必须把整个游走带映射
 * 到地板区——这里 y[70,100] → top[54,84]，故 y78→top60(脚~66)、y85→top67(脚~73)，
 * 全程在 56% 地板线以下。 */
function groundPos(x: number, y: number): { left: number; top: number } {
  const left = 8 + (x / 100) * 84;
  const top = 54 + ((y - 70) / 30) * 30; // y70→54, y100→84
  return { left, top: Math.max(54, Math.min(86, top)) };
}

// 猫越靠后（y 小）越小、越靠前（y 大）越大，做远近缩放（伪透视）。
function depthScale(y: number): number {
  return 0.78 + ((y - 70) / 30) * 0.34; // y70→0.78, y100→1.12
}

/* ── 精细 SVG 猫（多部件，可按 pose 动） ─────────────────────────────── */

const CAT_W = 150;
const CAT_H = 140;

function CatSprite({ state }: { state: CatState }) {
  // pose → CSS class，驱动 globals.css 里的关键帧/姿态。
  const poseClass = `cat25-${state.pose}`;
  // 朝向：facing -1 时水平翻转。
  const flip = state.facing === -1 ? -1 : 1;

  return (
    <div
      className={`cat25-sprite ${poseClass}`}
      style={{ width: CAT_W, height: CAT_H, transform: `scaleX(${flip})` }}
    >
      <svg viewBox="0 0 150 140" width={CAT_W} height={CAT_H} className="cat25-svg">
        <defs>
          <radialGradient id="c25-body" cx="42%" cy="34%" r="75%">
            <stop offset="0%" stopColor="#f4b86e" />
            <stop offset="62%" stopColor="#e89f4f" />
            <stop offset="100%" stopColor="#d2843a" />
          </radialGradient>
          <radialGradient id="c25-head" cx="44%" cy="36%" r="72%">
            <stop offset="0%" stopColor="#f6bd75" />
            <stop offset="70%" stopColor="#eaa153" />
            <stop offset="100%" stopColor="#d98c3f" />
          </radialGradient>
          <linearGradient id="c25-belly" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbe6cf" />
            <stop offset="100%" stopColor="#f3d9b3" />
          </linearGradient>
        </defs>

        {/* 尾巴（在身体后，独立摆动） */}
        <g className="cat25-tail">
          <path
            d="M112 96 C 140 92, 150 64, 138 44 C 134 56, 124 70, 110 80 Z"
            fill="url(#c25-body)"
            stroke="#c0792f"
            strokeWidth="1.5"
          />
          <path d="M141 40 C 150 50, 149 60, 143 66 C 140 56, 138 48, 137 44 Z" fill="#c0792f" />
        </g>

        {/* 后腿 */}
        <ellipse className="cat25-hindleg" cx="96" cy="116" rx="15" ry="20" fill="url(#c25-body)" stroke="#c0792f" strokeWidth="1.2" />

        {/* 身体 */}
        <g className="cat25-body">
          <ellipse cx="74" cy="96" rx="44" ry="34" fill="url(#c25-body)" stroke="#c0792f" strokeWidth="1.5" />
          {/* 肚皮 */}
          <ellipse cx="66" cy="106" rx="28" ry="20" fill="url(#c25-belly)" opacity="0.92" />
          {/* 虎斑 */}
          <path d="M58 66 q 8 8 4 18" stroke="#c47e34" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6" />
          <path d="M74 62 q 8 9 5 20" stroke="#c47e34" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6" />
          <path d="M90 66 q 7 8 4 17" stroke="#c47e34" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6" />
        </g>

        {/* 前腿（两条，走路交替） */}
        <g className="cat25-frontlegs">
          <rect className="cat25-legL" x="48" y="108" width="13" height="26" rx="6" fill="url(#c25-body)" stroke="#c0792f" strokeWidth="1.2" />
          <rect className="cat25-legR" x="70" y="108" width="13" height="26" rx="6" fill="url(#c25-body)" stroke="#c0792f" strokeWidth="1.2" />
        </g>

        {/* 头（含耳/脸/眼/鼻/须） */}
        <g className="cat25-head">
          {/* 耳 */}
          <path className="cat25-earL" d="M30 44 L 22 14 L 48 34 Z" fill="url(#c25-head)" stroke="#c0792f" strokeWidth="1.5" />
          <path className="cat25-earR" d="M78 36 L 92 10 L 66 30 Z" fill="url(#c25-head)" stroke="#c0792f" strokeWidth="1.5" />
          <path d="M30 40 L 26 22 L 42 33 Z" fill="#f3b3a0" />
          <path d="M76 33 L 86 18 L 70 29 Z" fill="#f3b3a0" />
          {/* 脸 */}
          <ellipse cx="52" cy="52" rx="34" ry="30" fill="url(#c25-head)" stroke="#c0792f" strokeWidth="1.5" />
          {/* 脸颊绒毛 */}
          <circle cx="26" cy="58" r="9" fill="url(#c25-head)" />
          <circle cx="78" cy="58" r="9" fill="url(#c25-head)" />
          {/* 口鼻 */}
          <ellipse cx="52" cy="62" rx="15" ry="11" fill="url(#c25-belly)" />
          {/* 眼（眯眼动画用 .cat25-eye scaleY） */}
          <g className="cat25-eye">
            <ellipse cx="40" cy="48" rx="6.5" ry="8" fill="#fff" />
            <ellipse cx="40" cy="48" rx="3" ry="7" fill="#caa23a" />
            <ellipse cx="40" cy="48" rx="1.4" ry="6.5" fill="#1c1c22" />
          </g>
          <g className="cat25-eye">
            <ellipse cx="64" cy="48" rx="6.5" ry="8" fill="#fff" />
            <ellipse cx="64" cy="48" rx="3" ry="7" fill="#caa23a" />
            <ellipse cx="64" cy="48" rx="1.4" ry="6.5" fill="#1c1c22" />
          </g>
          {/* 鼻 + 嘴 */}
          <path d="M48 58 L 56 58 L 52 63 Z" fill="#d96b6b" />
          <path d="M52 63 q -4 5 -9 4 M52 63 q 4 5 9 4" stroke="#b9783a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          {/* 胡须 */}
          <g stroke="#fbf3e6" strokeWidth="1.3" strokeLinecap="round" opacity="0.9">
            <line x1="38" y1="60" x2="8" y2="54" />
            <line x1="38" y1="63" x2="9" y2="64" />
            <line x1="66" y1="60" x2="96" y2="54" />
            <line x1="66" y1="63" x2="95" y2="64" />
          </g>
        </g>
      </svg>
    </div>
  );
}

/* ── 等距房间布景（SVG 图层） ───────────────────────────────────────── */

function Room() {
  return (
    <div className="cat25-room">
      {/* 后墙 + 窗 */}
      <div className="cat25-wall">
        <svg viewBox="0 0 600 280" preserveAspectRatio="none" className="cat25-wall-svg">
          <defs>
            <linearGradient id="c25-wallg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f6ead8" />
              <stop offset="100%" stopColor="#ecdcc4" />
            </linearGradient>
            <linearGradient id="c25-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bfe6ff" />
              <stop offset="100%" stopColor="#e7f6ff" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="600" height="280" fill="url(#c25-wallg)" />
          {/* 窗 */}
          <g transform="translate(120 40)">
            <rect x="-12" y="-12" width="184" height="150" rx="8" fill="#c79a64" />
            <rect x="0" y="0" width="160" height="126" fill="url(#c25-sky)" />
            {/* 远山/云 */}
            <circle cx="118" cy="34" r="26" fill="#fff6d2" opacity="0.95" />
            <ellipse cx="46" cy="86" rx="34" ry="14" fill="#ffffff" opacity="0.7" />
            <ellipse cx="96" cy="70" rx="26" ry="11" fill="#ffffff" opacity="0.6" />
            {/* 窗棂 */}
            <rect x="76" y="0" width="8" height="126" fill="#c79a64" />
            <rect x="0" y="59" width="160" height="8" fill="#c79a64" />
          </g>
          {/* 挂画 */}
          <g transform="translate(430 56)">
            <rect x="0" y="0" width="92" height="72" rx="4" fill="#d9b98c" />
            <rect x="8" y="8" width="76" height="56" fill="#f7efe1" />
            <path d="M14 56 L 36 28 L 52 46 L 66 30 L 78 56 Z" fill="#9ec6a3" />
            <circle cx="60" cy="22" r="7" fill="#f4c95b" />
          </g>
        </svg>
      </div>

      {/* 倾斜地板（CSS rotateX 透视）+ 地毯 + 阳光斑 */}
      <div className="cat25-floor">
        <div className="cat25-floor-surface" />
        {/* 阳光斑（窗光投影） */}
        <div className="cat25-sunbeam" />
        {/* 地毯 */}
        <div className="cat25-rug" />
      </div>
    </div>
  );
}

// 猫爬架（SVG，立在后左）。
function CatTree({ style }: { style?: CSSProperties }) {
  return (
    <div className="cat25-prop cat25-tree" style={style}>
      <svg viewBox="0 0 120 220" width="120" height="220">
        <defs>
          <linearGradient id="c25-post" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d9bd8f" />
            <stop offset="50%" stopColor="#c9a86f" />
            <stop offset="100%" stopColor="#b8945a" />
          </linearGradient>
        </defs>
        {/* 底座 */}
        <ellipse cx="60" cy="206" rx="46" ry="13" fill="#b8945a" />
        <ellipse cx="60" cy="201" rx="46" ry="13" fill="#c9a86f" />
        {/* 立柱（缠绳纹） */}
        <rect x="48" y="70" width="24" height="135" rx="6" fill="url(#c25-post)" />
        {[80, 96, 112, 128, 144, 160, 176, 192].map((y) => (
          <line key={y} x1="48" y1={y} x2="72" y2={y - 5} stroke="#b08a52" strokeWidth="2" opacity="0.5" />
        ))}
        {/* 中层平台 */}
        <ellipse cx="86" cy="120" rx="30" ry="11" fill="#e0938a" />
        <ellipse cx="86" cy="116" rx="30" ry="11" fill="#ec9f95" />
        <rect x="78" y="116" width="14" height="14" fill="url(#c25-post)" />
        {/* 顶层平台 + 窝 */}
        <ellipse cx="60" cy="64" rx="40" ry="14" fill="#e0938a" />
        <ellipse cx="60" cy="58" rx="40" ry="14" fill="#ec9f95" />
        <path d="M26 56 a 34 16 0 0 0 68 0 a 34 22 0 0 1 -68 0 Z" fill="#e8b96f" />
        {/* 逗猫球 */}
        <line x1="98" y1="120" x2="104" y2="150" stroke="#b08a52" strokeWidth="1.5" />
        <circle cx="104" cy="156" r="8" fill="#e06b6b" />
      </svg>
    </div>
  );
}

// 食盆（SVG，立在右前）。
function FoodBowl({ style }: { style?: CSSProperties }) {
  return (
    <div className="cat25-prop cat25-bowl" style={style}>
      <svg viewBox="0 0 90 56" width="90" height="56">
        <ellipse cx="45" cy="40" rx="40" ry="13" fill="#4a90ad" />
        <ellipse cx="45" cy="34" rx="40" ry="13" fill="#6fb6d6" />
        <ellipse cx="45" cy="32" rx="30" ry="9" fill="#3f7e98" />
        {/* 猫粮 */}
        {[
          [34, 30],
          [46, 28],
          [56, 31],
          [40, 33],
          [52, 33],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="4.5" fill="#a9743c" />
        ))}
      </svg>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Cat25DScene = forwardRef<Cat25DHandle, {}>(function Cat25DScene(_props, ref) {
  const behavior = useCatBehavior();
  useImperativeHandle(ref, () => ({ react: behavior.react }), [behavior.react]);
  const { state } = behavior;

  // perch：把猫定位到爬架顶窝（爬架 base top 64%、顶窝在其上方约 33%），其余按地面。
  // 顶窝偏右一点对齐窝口；猫在高处略缩小（远 + 蹲）。
  const perching = state.pose === 'perch';
  const ground = perching ? { left: 14.5, top: 33 } : groundPos(state.x, state.y);
  const scale = perching ? 0.6 : depthScale(state.y);

  // 食盆按舞台坐标放（与 PROP_POS.purr 对齐：x74,y85）。
  const bowlPos = groundPos(74, 85);

  return (
    <div className="cat-3d-stage cat25-stage">
      <Room />

      {/* 爬架（后左角，底座立在可见地板上）：墙底约 52%、地板可见 56%~92%，
          所以让爬架底边(translate -100%)落在 top≈64%，整架在地板里、不浮到墙上。 */}
      <CatTree
        style={{
          left: '14%',
          top: '64%',
          transform: 'translate(-50%, -100%) scale(0.82)',
          zIndex: 64,
        }}
      />

      {/* 猫（按 y 排序 zIndex，越靠前越上层；perch 时坐爬架顶窝、压在爬架之上） */}
      <div
        className="cat25-actor"
        style={{
          left: `${ground.left}%`,
          top: `${ground.top}%`,
          transform: `translate(-50%, -82%) scale(${scale})`,
          transition: state.moveMs
            ? `left ${state.moveMs}ms linear, top ${state.moveMs}ms linear, transform ${state.moveMs}ms linear`
            : perching
              ? 'left 520ms cubic-bezier(.5,-0.3,.5,1), top 520ms cubic-bezier(.5,-0.3,.5,1), transform 520ms ease'
              : 'transform 220ms ease',
          zIndex: perching ? 70 : Math.round(ground.top),
        }}
      >
        <CatSprite state={state} />
        {/* 蹲爬架时不在地面投影 */}
        {!perching && <div className="cat25-shadow" />}
      </div>

      {/* 食盆（前排） */}
      <FoodBowl
        style={{
          left: `${bowlPos.left}%`,
          top: `${bowlPos.top}%`,
          transform: `translate(-50%, -60%) scale(${depthScale(85)})`,
          zIndex: Math.round(bowlPos.top),
        }}
      />
    </div>
  );
});

// 兼容旧名（父组件曾 import Cat3DScene）。
export const Cat3DScene = Cat25DScene;

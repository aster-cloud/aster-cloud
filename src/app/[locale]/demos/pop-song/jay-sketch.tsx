'use client';

/**
 * 程序化周杰伦简笔画(纯 SVG,零外部资源、CSP 友好)。
 * 引擎裁决出的 SketchStyle 决定画哪一幅——同 cat-mood:决策驱动画面,非预存图片。
 *
 * 四种风格:
 *  - sunny  :阳光下弹吉他(《晴天》)——头顶太阳、手抱吉他。
 *  - chinese:执笔的中国风侧影(《青花瓷》)——毛笔 + 青花瓷瓶。
 *  - kungfu :双截棍武术姿(《双截棍》)——马步 + 双截棍。
 *  - default:戴帽低头的经典侧影——鸭舌帽 + 麦克风。
 *
 * 简笔画=火柴人骨架 + 每风格一两个标志性道具,线条克制。配色走主题 token(currentColor 描边)。
 */
import type { SketchStyle } from '@/config/pop-song-demo';

/** 火柴人骨架(四风格共用):头、身、两臂两腿。姿势按风格微调由各风格覆盖。 */
function StickBody({ armPose }: { armPose: 'guitar' | 'brush' | 'nunchaku' | 'mic' }) {
  // 关节坐标(viewBox 0 0 200 200)。头心 (100,52) r18;躯干 (100,70)→(100,120)。
  const arms = {
    // 抱吉他:双手在身前偏下
    guitar: <path d="M100 82 L70 108 M100 82 L128 100" />,
    // 执笔:右手抬起持笔,左手负后
    brush: <path d="M100 82 L132 66 M100 82 L74 100" />,
    // 双截棍:双臂张开握棍
    nunchaku: <path d="M100 82 L64 74 M100 82 L136 92" />,
    // 握麦:右手抬至嘴边,左手垂
    mic: <path d="M100 82 L118 60 M100 82 L84 112" />,
  }[armPose];
  const legs = armPose === 'nunchaku'
    ? <path d="M100 120 L78 160 M100 120 L122 160" /> // 马步:叉开
    : <path d="M100 120 L88 162 M100 120 L112 162" />; // 站立
  return (
    <g fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={100} cy={52} r={18} />
      <path d="M100 70 L100 120" />
      {arms}
      {legs}
    </g>
  );
}

function SunnyScene() {
  return (
    <g>
      {/* 太阳 */}
      <g stroke="currentColor" strokeWidth={3} strokeLinecap="round" fill="none" className="text-amber-500">
        <circle cx={158} cy={36} r={12} fill="currentColor" fillOpacity={0.15} />
        <path d="M158 16 L158 8 M158 64 L158 56 M138 36 L130 36 M186 36 L178 36 M144 22 L138 16 M172 50 L178 56 M172 22 L178 16 M144 50 L138 56" />
      </g>
      <StickBody armPose="guitar" />
      {/* 吉他:椭圆琴身 + 琴颈 */}
      <g fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round">
        <ellipse cx={98} cy={104} rx={20} ry={13} transform="rotate(-18 98 104)" />
        <path d="M112 96 L142 74" />
      </g>
    </g>
  );
}

function ChineseScene() {
  return (
    <g>
      {/* 青花瓷瓶(右下) */}
      <g fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" className="text-sky-600">
        <path d="M150 150 q-14 -6 -14 -26 q0 -14 8 -18 q-6 -8 6 -12 q12 4 6 12 q8 4 8 18 q0 20 -14 26 Z" />
        <path d="M140 118 q6 6 12 0 M138 132 q8 8 16 0" strokeWidth={2} />
      </g>
      <StickBody armPose="brush" />
      {/* 毛笔:斜持 */}
      <g fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round">
        <path d="M132 66 L152 44" />
        <path d="M150 46 L156 38" strokeWidth={5} />
      </g>
    </g>
  );
}

function KungfuScene() {
  return (
    <g>
      <StickBody armPose="nunchaku" />
      {/* 双截棍:两节短棍 + 链 */}
      <g fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" className="text-rose-600">
        <path d="M64 74 L44 66" />
        <path d="M44 66 L40 84" strokeDasharray="2 3" strokeWidth={2} />
        <path d="M40 84 L34 100" />
      </g>
      {/* 气势线 */}
      <g stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="text-rose-400" opacity={0.7}>
        <path d="M150 90 L166 88 M150 100 L170 100 M150 110 L164 112" />
      </g>
    </g>
  );
}

function DefaultScene() {
  return (
    <g>
      <StickBody armPose="mic" />
      {/* 鸭舌帽:盖在头上 */}
      <g fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M82 44 q18 -14 36 0" />
        <path d="M118 44 L138 46" />
      </g>
      {/* 麦克风:圆头 + 杆 */}
      <g fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round">
        <circle cx={122} cy={54} r={5} fill="currentColor" fillOpacity={0.2} />
        <path d="M120 58 L114 66" />
      </g>
    </g>
  );
}

const SCENES: Record<SketchStyle, () => React.JSX.Element> = {
  sunny: SunnyScene,
  chinese: ChineseScene,
  kungfu: KungfuScene,
  default: DefaultScene,
};

/** 按裁决风格渲染一幅简笔画。style=null 时画空舞台(未执行)。 */
export function JaySketch({ style }: { style: SketchStyle | null }) {
  const Scene = style ? SCENES[style] : null;
  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={style ? `简笔画风格:${style}` : '待执行'}
      className="h-full w-full text-fg"
    >
      {/* 地面线 */}
      <path d="M40 168 L160 168" stroke="currentColor" strokeWidth={3} strokeLinecap="round" opacity={0.3} />
      {Scene ? (
        <Scene />
      ) : (
        <text x={100} y={100} textAnchor="middle" className="fill-fg-muted text-[10px]">
          点「执行」让引擎裁决
        </text>
      )}
    </svg>
  );
}

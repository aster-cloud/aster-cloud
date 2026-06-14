'use client';

import { useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { CatMood } from '@/config/cat-mood';
import { useCatBehavior, type CatPose } from './use-cat-behavior';

/**
 * 3D 程序化猫场景：纯 Three.js + R3F 用基本几何体（capsule/sphere/cylinder/cone）
 * 手搓一只低多边形小猫——不用任何外部模型/贴图/WASM，零远程资源、零 CSP 风险。
 *
 * 骨骼 = Group 父子层级：根 group（整体位移/朝向）→ body（起伏/拉伸）→ head（点头/
 * 抬头）、四条腿（走路 sin 交替摆）、尾巴多节链（柔顺波动）、双耳（警觉抖动）。
 * 动画全程序化：useFrame 每帧用 sin/插值直接驱动各 group 的 rotation/position/scale，
 * pose 决定参数（步频、尾摆幅度、身体高度、头部角度），所以每个规则都有贴合的动作。
 *
 * WebGL 不能 SSR：本组件由父级 dynamic(ssr:false) 加载。
 *
 * pose → 动作语义：
 *   walk 四腿交替踏步 + 身体起伏 + 尾巴轻摆；sit 端坐尾巴卷；groom 低头舔毛；
 *   stretch 前压后伸懒腰；sleep 趴下慢呼吸；eat 走到碗前低头一口口；
 *   purr 满足坐姿尾巴慢摆（呼噜微颤）；loaf 缩成猫面包（腿收身体压扁）；
 *   floof 炸毛弓背（身体拱起+整体放大+抖动）；judge 高傲端坐尾巴慢扫。
 */

export interface Cat3DHandle {
  react: (mood: CatMood) => void;
}

// 把舞台百分比坐标 (x:0..100, y:0..100) 映射到 3D 地面 (X 横向, Z 纵深)。
function toWorld(x: number, y: number): [number, number] {
  const wx = ((x - 50) / 100) * 9; // -4.5..4.5
  const wz = ((y - 80) / 100) * 6 + 0.5; // y 越大越靠前
  return [wx, wz];
}

// 每种 pose 的动作参数：步频、尾摆、身体基准高/起伏、头部俯仰、整体缩放、弓背、抖动。
interface PoseParams {
  step: number; // 腿摆频率（0=不动）
  legSwing: number; // 腿摆幅度
  bodyY: number; // 身体基准高度
  bob: number; // 身体上下起伏幅度
  tailWag: number; // 尾摆频率
  tailAmp: number; // 尾摆幅度
  headPitch: number; // 头俯仰（正=低头）
  scale: number; // 整体缩放
  arch: number; // 弓背（身体绕 X 拱起）
  jitter: number; // 高频抖动（炸毛/呼噜）
  crouch: number; // 腿收缩（趴/猫面包）
  breathe: number; // 呼吸频率
}

// bodyY = 相对 BODY_BASE 的小偏移（站立≈0）；下蹲/趴用 crouch 控制（会同时收腿+降身保持脚贴地）。
const POSE: Record<CatPose, PoseParams> = {
  walk:    { step: 7,  legSwing: 0.55, bodyY: 0.0,  bob: 0.05, tailWag: 3,   tailAmp: 0.35, headPitch: 0,    scale: 1,    arch: 0,    jitter: 0,   crouch: 0,   breathe: 2 },
  sit:     { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 1.2, tailAmp: 0.25, headPitch: -0.1, scale: 1,    arch: 0,    jitter: 0,   crouch: 0.4, breathe: 2 },
  groom:   { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 0.8, tailAmp: 0.15, headPitch: 0.7,  scale: 1,    arch: 0.1,  jitter: 0,   crouch: 0.4, breathe: 2 },
  stretch: { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 1,   tailAmp: 0.4,  headPitch: -0.3, scale: 1,    arch: -0.5, jitter: 0,   crouch: 0,   breathe: 1.5 },
  sleep:   { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 0.3, tailAmp: 0.1,  headPitch: 0.5,  scale: 1,    arch: 0,    jitter: 0,   crouch: 1,   breathe: 1 },
  eat:     { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 1.5, tailAmp: 0.2,  headPitch: 0.9,  scale: 1,    arch: 0.15, jitter: 0,   crouch: 0.3, breathe: 3 },
  // CatMood：
  purr:    { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 1,   tailAmp: 0.3,  headPitch: -0.05,scale: 1.02, arch: 0,    jitter: 0.4, crouch: 0.4, breathe: 4 },
  loaf:    { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 0.4, tailAmp: 0.08, headPitch: 0.1,  scale: 1,    arch: 0,    jitter: 0,   crouch: 1,   breathe: 1.4 },
  floof:   { step: 0,  legSwing: 0,    bodyY: 0.06, bob: 0,    tailWag: 8,   tailAmp: 0.6,  headPitch: -0.2, scale: 1.18, arch: 0.7,  jitter: 1.2, crouch: 0,   breathe: 5 },
  judge:   { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 0.6, tailAmp: 0.45, headPitch: -0.25,scale: 1,    arch: 0,    jitter: 0,   crouch: 0.3, breathe: 1.8 },
};

// 站立时 body group 中心离地高度——核定使四脚脚掌正好落在 y=0。
// 腿支点在 body 内 y=-0.18，腿圆柱底 + 脚掌球心约在支点下 0.46 → 0.18+0.46≈0.64。
const BODY_BASE = 0.64;

// 暖橘虎斑配色。
const FUR = '#e8a25c';
const FUR_DARK = '#d4863c';
const BELLY = '#f6e0c4';
const EAR_IN = '#f3b3a0';
const NOSE = '#d96b6b';

function CatModel({ behavior }: { behavior: ReturnType<typeof useCatBehavior> }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const trunk = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const tail2 = useRef<THREE.Group>(null);
  const tail3 = useRef<THREE.Group>(null);
  const earL = useRef<THREE.Group>(null);
  const earR = useRef<THREE.Group>(null);
  const legFL = useRef<THREE.Group>(null);
  const legFR = useRef<THREE.Group>(null);
  const legBL = useRef<THREE.Group>(null);
  const legBR = useRef<THREE.Group>(null);

  const { state } = behavior;

  // 目标世界坐标 + 朝向（平滑趋近，非瞬移）。
  const target = useRef(new THREE.Vector3(0, 0, 0.5));
  const targetYaw = useRef(0);
  // 平滑后的 pose 参数（pose 切换时插值过渡，避免突变）。
  const p = useRef<PoseParams>({ ...POSE.sit });

  useFrame((_, dt) => {
    const r = root.current;
    if (!r) return;
    const tNow = performance.now() / 1000;

    // 1) 目标位置/朝向更新（行进朝向 = 移动方向）。
    const [wx, wz] = toWorld(state.x, state.y);
    target.current.set(wx, 0, wz);
    targetYaw.current = state.facing === 1 ? Math.PI / 2 : -Math.PI / 2;

    // 2) 位置/转身平滑。
    const moveSpeed = state.pose === 'walk' ? 2.6 : 6;
    r.position.lerp(target.current, Math.min(1, dt * moveSpeed));
    let dyaw = targetYaw.current - r.rotation.y;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    r.rotation.y += dyaw * Math.min(1, dt * 6);

    // 3) pose 参数插值过渡。
    const tgt = POSE[state.pose] ?? POSE.sit;
    const k = Math.min(1, dt * 6);
    const cur = p.current;
    (Object.keys(tgt) as (keyof PoseParams)[]).forEach((key) => {
      cur[key] += (tgt[key] - cur[key]) * k;
    });

    // 4) 程序化动画。
    const jit = cur.jitter > 0.01 ? Math.sin(tNow * 40) * 0.03 * cur.jitter : 0;
    const breath = Math.sin(tNow * cur.breathe) * 0.012;

    // 身体：高度 + 走路起伏 + 弓背 + 缩放（含炸毛 jitter）+ 呼吸。
    // bodyY 是相对站立基准 BODY_BASE 的偏移；trunk（躯干视觉网格）单独压扁做猫面包，
    // body group 本身不缩 y（缩 y 会把腿一起拔起→脚悬空）。crouch 时整体略降，腿靠
    // crouchLift 收起，保证脚仍贴地。
    if (body.current) {
      const bob = cur.bob > 0 ? Math.abs(Math.sin(tNow * cur.step)) * cur.bob : 0;
      body.current.position.y = BODY_BASE + cur.bodyY - cur.crouch * 0.12 + bob + jit;
      body.current.rotation.x = -cur.arch; // 负=弓背向上拱
      body.current.scale.setScalar(cur.scale);
    }
    // 躯干视觉网格单独做呼吸 + 猫面包压扁（不影响腿的世界高度）。
    if (trunk.current) {
      trunk.current.scale.set(1, (1 + breath) * (1 - cur.crouch * 0.3), 1);
    }

    // 头：俯仰 + 走路轻微点头 + 炸毛抖。
    if (head.current) {
      const nod = state.pose === 'walk' ? Math.sin(tNow * cur.step) * 0.06 : 0;
      head.current.rotation.x = cur.headPitch + nod + jit * 2;
    }

    // 耳朵：警觉时（floof/judge）轻抖。
    const earTwitch = (state.pose === 'floof' ? 0.25 : 0.05) * Math.sin(tNow * 12);
    if (earL.current) earL.current.rotation.z = 0.25 + earTwitch;
    if (earR.current) earR.current.rotation.z = -0.25 - earTwitch;

    // 尾巴三节链：逐节相位延迟做柔顺波动。
    const wag = Math.sin(tNow * cur.tailWag);
    if (tail.current) tail.current.rotation.z = 0.5 + wag * cur.tailAmp;
    if (tail2.current) tail2.current.rotation.z = Math.sin(tNow * cur.tailWag - 0.6) * cur.tailAmp * 1.1;
    if (tail3.current) tail3.current.rotation.z = Math.sin(tNow * cur.tailWag - 1.2) * cur.tailAmp * 1.2;

    // 四条腿：走路 sin 交替（对角同相），其它 pose 收拢/站立。
    const swing = cur.step > 0 ? cur.legSwing : 0;
    const ph = tNow * cur.step;
    const crouchLift = cur.crouch * 0.18; // 趴下时腿收起
    if (legFL.current) legFL.current.rotation.x = Math.sin(ph) * swing - crouchLift;
    if (legBR.current) legBR.current.rotation.x = Math.sin(ph) * swing - crouchLift;
    if (legFR.current) legFR.current.rotation.x = Math.sin(ph + Math.PI) * swing - crouchLift;
    if (legBL.current) legBL.current.rotation.x = Math.sin(ph + Math.PI) * swing - crouchLift;
  });

  // 圆角材质（柔和）。
  const matFur = useMemo(() => new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.85 }), []);
  const matDark = useMemo(() => new THREE.MeshStandardMaterial({ color: FUR_DARK, roughness: 0.85 }), []);
  const matBelly = useMemo(() => new THREE.MeshStandardMaterial({ color: BELLY, roughness: 0.9 }), []);
  const matEar = useMemo(() => new THREE.MeshStandardMaterial({ color: EAR_IN, roughness: 0.9 }), []);
  const matNose = useMemo(() => new THREE.MeshStandardMaterial({ color: NOSE, roughness: 0.6 }), []);
  const matEye = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2b33', roughness: 0.3 }), []);

  // 一条腿（共用）：上端为旋转支点，圆柱向下 + 圆脚掌。
  const Leg = ({ refX, pos }: { refX: React.RefObject<THREE.Group | null>; pos: [number, number, number] }) => (
    <group ref={refX} position={pos}>
      <mesh castShadow position={[0, -0.22, 0]} material={matFur}>
        <cylinderGeometry args={[0.08, 0.1, 0.44, 12]} />
      </mesh>
      <mesh castShadow position={[0, -0.44, 0.02]} material={matDark}>
        <sphereGeometry args={[0.1, 12, 12]} />
      </mesh>
    </group>
  );

  return (
    <group ref={root} dispose={null} position={[0, 0, 0.5]}>
      {/* body：旋转/缩放支点在身体中心，站立时离地 BODY_BASE → 四脚落地。 */}
      <group ref={body} position={[0, BODY_BASE, 0]}>
        {/* trunk：躯干视觉网格组，单独做呼吸/猫面包压扁（不连累腿/头/尾的世界高度）。 */}
        <group ref={trunk}>
          {/* 躯干：拉长 capsule，沿 Z 朝前 */}
          <mesh castShadow material={matFur} rotation={[Math.PI / 2, 0, 0]}>
            <capsuleGeometry args={[0.33, 0.7, 8, 16]} />
          </mesh>
          {/* 肚皮：浅色小 capsule 贴下方 */}
          <mesh position={[0, -0.18, 0.05]} material={matBelly} rotation={[Math.PI / 2, 0, 0]}>
            <capsuleGeometry args={[0.26, 0.5, 8, 16]} />
          </mesh>
          {/* 背部虎斑（深色细条） */}
          <mesh position={[0, 0.28, 0]} material={matDark} rotation={[Math.PI / 2, 0, 0]}>
            <capsuleGeometry args={[0.12, 0.6, 6, 12]} />
          </mesh>
        </group>

        {/* head：连在躯干前端（+Z） */}
        <group ref={head} position={[0, 0.18, 0.62]}>
          <mesh castShadow material={matFur}>
            <sphereGeometry args={[0.3, 20, 20]} />
          </mesh>
          {/* 口鼻 */}
          <mesh position={[0, -0.05, 0.27]} material={matBelly}>
            <sphereGeometry args={[0.16, 16, 16]} />
          </mesh>
          {/* 鼻 */}
          <mesh position={[0, -0.02, 0.4]} material={matNose}>
            <coneGeometry args={[0.05, 0.06, 8]} />
          </mesh>
          {/* 眼 */}
          <mesh position={[-0.12, 0.06, 0.25]} material={matEye}>
            <sphereGeometry args={[0.055, 12, 12]} />
          </mesh>
          <mesh position={[0.12, 0.06, 0.25]} material={matEye}>
            <sphereGeometry args={[0.055, 12, 12]} />
          </mesh>
          {/* 耳：圆锥，支点在耳根 */}
          <group ref={earL} position={[-0.18, 0.24, 0]}>
            <mesh castShadow material={matFur} position={[0, 0.1, 0]}>
              <coneGeometry args={[0.12, 0.26, 4]} />
            </mesh>
            <mesh material={matEar} position={[0, 0.09, 0.04]} scale={[0.6, 0.7, 0.6]}>
              <coneGeometry args={[0.12, 0.26, 4]} />
            </mesh>
          </group>
          <group ref={earR} position={[0.18, 0.24, 0]}>
            <mesh castShadow material={matFur} position={[0, 0.1, 0]}>
              <coneGeometry args={[0.12, 0.26, 4]} />
            </mesh>
            <mesh material={matEar} position={[0, 0.09, 0.04]} scale={[0.6, 0.7, 0.6]}>
              <coneGeometry args={[0.12, 0.26, 4]} />
            </mesh>
          </group>
        </group>

        {/* tail：三节链，连在躯干后端（-Z），逐节缩短 */}
        <group ref={tail} position={[0, 0.15, -0.62]}>
          <mesh castShadow material={matFur} position={[0, 0.12, 0]}>
            <capsuleGeometry args={[0.07, 0.22, 6, 12]} />
          </mesh>
          <group ref={tail2} position={[0, 0.26, 0]}>
            <mesh castShadow material={matFur} position={[0, 0.1, 0]}>
              <capsuleGeometry args={[0.06, 0.18, 6, 12]} />
            </mesh>
            <group ref={tail3} position={[0, 0.22, 0]}>
              <mesh castShadow material={matDark} position={[0, 0.08, 0]}>
                <capsuleGeometry args={[0.05, 0.14, 6, 12]} />
              </mesh>
            </group>
          </group>
        </group>

        {/* 四条腿：支点在身体中心略下，前后各一对 */}
        <Leg refX={legFL} pos={[-0.2, -0.18, 0.4]} />
        <Leg refX={legFR} pos={[0.2, -0.18, 0.4]} />
        <Leg refX={legBL} pos={[-0.2, -0.18, -0.4]} />
        <Leg refX={legBR} pos={[0.2, -0.18, -0.4]} />
      </group>
    </group>
  );
}

/* ── 室内布景子组件（纯几何，零外部资源） ───────────────────────────── */

// 房间：木地板 + 三面墙（后墙 -Z、左墙 -X、右墙 +X），墙面只朝内（BackSide 朝相机透出去）。
function Room() {
  const wallH = 5;
  const halfW = 7; // 房间半宽（X）
  const depth = 9; // 房间纵深（Z），后墙在 z=-back
  const back = -5.5;
  return (
    <group>
      {/* 木地板（条纹靠材质色，足够简洁） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[halfW * 2, depth + 4]} />
        <meshStandardMaterial color="#dcb079" roughness={0.85} />
      </mesh>
      {/* 后墙（米色） */}
      <mesh position={[0, wallH / 2, back]} receiveShadow>
        <planeGeometry args={[halfW * 2, wallH]} />
        <meshStandardMaterial color="#f3e7d6" roughness={1} />
      </mesh>
      {/* 左墙 */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-halfW, wallH / 2, back + depth / 2]} receiveShadow>
        <planeGeometry args={[depth, wallH]} />
        <meshStandardMaterial color="#ecdfcd" roughness={1} />
      </mesh>
      {/* 右墙 */}
      <mesh rotation={[0, -Math.PI / 2, 0]} position={[halfW, wallH / 2, back + depth / 2]} receiveShadow>
        <planeGeometry args={[depth, wallH]} />
        <meshStandardMaterial color="#ecdfcd" roughness={1} />
      </mesh>
      {/* 踢脚线（后墙底，深色细条增加立体感） */}
      <mesh position={[0, 0.12, back + 0.02]}>
        <boxGeometry args={[halfW * 2, 0.24, 0.05]} />
        <meshStandardMaterial color="#c8a87e" roughness={1} />
      </mesh>
    </group>
  );
}

// 窗户：嵌在后墙上的方窗，木框 + 浅蓝天空 + 十字窗棂，透出暖阳。
function Window({ x = -2.4, y = 2.7, z = -5.46 }: { x?: number; y?: number; z?: number }) {
  const w = 2.6;
  const h = 2.2;
  const frame = '#b98a5e';
  return (
    <group position={[x, y, z]}>
      {/* 天空（窗内，朝相机 +Z；用 basic 自发光感，不受光） */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#bfe3ff" />
      </mesh>
      {/* 远处暖阳光晕 */}
      <mesh position={[0.5, 0.4, 0.02]}>
        <circleGeometry args={[0.5, 32]} />
        <meshBasicMaterial color="#fff3c4" transparent opacity={0.85} />
      </mesh>
      {/* 窗框（四边 box） */}
      <mesh position={[0, h / 2 + 0.08, 0.04]} castShadow>
        <boxGeometry args={[w + 0.32, 0.16, 0.18]} />
        <meshStandardMaterial color={frame} roughness={0.7} />
      </mesh>
      <mesh position={[0, -h / 2 - 0.08, 0.04]} castShadow>
        <boxGeometry args={[w + 0.32, 0.16, 0.22]} />
        <meshStandardMaterial color={frame} roughness={0.7} />
      </mesh>
      <mesh position={[-w / 2 - 0.08, 0, 0.04]} castShadow>
        <boxGeometry args={[0.16, h + 0.16, 0.18]} />
        <meshStandardMaterial color={frame} roughness={0.7} />
      </mesh>
      <mesh position={[w / 2 + 0.08, 0, 0.04]} castShadow>
        <boxGeometry args={[0.16, h + 0.16, 0.18]} />
        <meshStandardMaterial color={frame} roughness={0.7} />
      </mesh>
      {/* 窗棂十字 */}
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[0.08, h, 0.06]} />
        <meshStandardMaterial color={frame} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[w, 0.08, 0.06]} />
        <meshStandardMaterial color={frame} roughness={0.7} />
      </mesh>
    </group>
  );
}

// 立体食盆：外碗 + 内凹深色 + 猫粮（右侧地面，对齐 PROP_POS.purr → 舞台 x≈74 → world x≈2.6）。
function FoodBowl({ pos = [2.6, 0, 0.6] as [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.11, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.3, 0.22, 28]} />
        <meshStandardMaterial color="#6fb6d6" roughness={0.5} />
      </mesh>
      {/* 内凹（深色，营造碗的厚度） */}
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 0.04, 28]} />
        <meshStandardMaterial color="#4a90ad" roughness={0.6} />
      </mesh>
      {/* 猫粮（小颗粒堆，几个棕色小球） */}
      {[
        [0, 0.22, 0],
        [0.12, 0.22, 0.05],
        [-0.1, 0.22, -0.06],
        [0.04, 0.24, -0.1],
        [-0.06, 0.24, 0.1],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} castShadow>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#a9743c" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// 猫爬架：底座 + 立柱（缠绳纹用色）+ 两层平台 + 顶层窝（后排左角）。
function CatTree({ pos = [-4.6, 0, -3.8] as [number, number, number] }) {
  const post = '#c9a06a';
  const rope = '#cdb289';
  const plat = '#d98c84';
  return (
    <group position={pos}>
      {/* 底座 */}
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.85, 0.95, 0.16, 24]} />
        <meshStandardMaterial color={post} roughness={0.8} />
      </mesh>
      {/* 主立柱（缠绳） */}
      <mesh position={[0, 1.2, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 2.3, 20]} />
        <meshStandardMaterial color={rope} roughness={1} />
      </mesh>
      {/* 第二根短柱（到中层） */}
      <mesh position={[0.55, 0.75, 0.2]} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 1.4, 16]} />
        <meshStandardMaterial color={rope} roughness={1} />
      </mesh>
      {/* 中层平台 */}
      <mesh position={[0.55, 1.5, 0.2]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.12, 1.1]} />
        <meshStandardMaterial color={plat} roughness={0.95} />
      </mesh>
      {/* 顶层平台 */}
      <mesh position={[0, 2.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.3, 0.14, 1.3]} />
        <meshStandardMaterial color={plat} roughness={0.95} />
      </mesh>
      {/* 顶层猫窝（半开口圆筒） */}
      <mesh position={[0, 2.75, -0.1]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 0.5, 20, 1, true]} />
        <meshStandardMaterial color="#e8b96f" roughness={0.95} side={THREE.DoubleSide} />
      </mesh>
      {/* 悬挂逗猫球 */}
      <mesh position={[0.55, 2.0, 0.55]} castShadow>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color="#e06b6b" roughness={0.7} />
      </mesh>
    </group>
  );
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Cat3DScene = forwardRef<Cat3DHandle, {}>(function Cat3DScene(_props, ref) {
  const behavior = useCatBehavior();
  useImperativeHandle(ref, () => ({ react: behavior.react }), [behavior.react]);

  return (
    <div className="cat-3d-stage">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 3.4, 8.2], fov: 42 }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
      >
        {/* 暖色室内光（纯本地光，无远程 HDR）：半球环境光 + 从窗口斜射的阳光（投影）+ 暖补光 */}
        <hemisphereLight args={['#fff4e2', '#c8a878', 0.85]} />
        <ambientLight intensity={0.4} />
        {/* 阳光：从窗（后墙左上）方向斜射进屋，目标对准地面阳光斑，投出长影 */}
        <directionalLight
          position={[-3, 6, -2]}
          intensity={2.1}
          color="#fff0cf"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-9}
          shadow-camera-right={9}
          shadow-camera-top={9}
          shadow-camera-bottom={-9}
          shadow-bias={-0.0005}
        />
        {/* 暖补光（右前，填阴影） */}
        <directionalLight position={[5, 3, 4]} intensity={0.4} color="#ffe2b8" />

        {/* 房间（地板 + 三面墙）+ 窗 */}
        <Room />
        <Window />

        {/* 窗光投到地面的阳光斑（暖色半透发光片，对齐 PROP_POS.loaf → 舞台 x≈28 → world x≈-2） */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2, 0.012, 0.4]}>
          <circleGeometry args={[1.8, 40]} />
          <meshBasicMaterial color="#ffe9a8" transparent opacity={0.45} />
        </mesh>
        {/* 地毯（judge 道具感，中央偏前） */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.4, 0.006, 0.8]} receiveShadow>
          <circleGeometry args={[2.3, 48]} />
          <meshStandardMaterial color="#e88f86" roughness={1} />
        </mesh>

        {/* 道具：食盆（右）+ 猫爬架（后左角） */}
        <FoodBowl />
        <CatTree />

        <CatModel behavior={behavior} />
        <ContactShadows position={[0, 0.004, 0]} opacity={0.35} scale={14} blur={2.4} far={5} />
      </Canvas>
    </div>
  );
});

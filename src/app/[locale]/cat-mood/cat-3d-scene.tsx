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

const POSE: Record<CatPose, PoseParams> = {
  walk:    { step: 7,  legSwing: 0.55, bodyY: 0.0,  bob: 0.05, tailWag: 3,   tailAmp: 0.35, headPitch: 0,    scale: 1,    arch: 0,    jitter: 0,   crouch: 0,   breathe: 2 },
  sit:     { step: 0,  legSwing: 0,    bodyY: 0.05, bob: 0,    tailWag: 1.2, tailAmp: 0.25, headPitch: -0.1, scale: 1,    arch: 0,    jitter: 0,   crouch: 0.3, breathe: 2 },
  groom:   { step: 0,  legSwing: 0,    bodyY: 0.05, bob: 0,    tailWag: 0.8, tailAmp: 0.15, headPitch: 0.7,  scale: 1,    arch: 0.1,  jitter: 0,   crouch: 0.3, breathe: 2 },
  stretch: { step: 0,  legSwing: 0,    bodyY: -0.05,bob: 0,    tailWag: 1,   tailAmp: 0.4,  headPitch: -0.3, scale: 1,    arch: -0.5, jitter: 0,   crouch: 0,   breathe: 1.5 },
  sleep:   { step: 0,  legSwing: 0,    bodyY: -0.18,bob: 0,    tailWag: 0.3, tailAmp: 0.1,  headPitch: 0.5,  scale: 1,    arch: 0,    jitter: 0,   crouch: 0.9, breathe: 1 },
  eat:     { step: 0,  legSwing: 0,    bodyY: 0.0,  bob: 0,    tailWag: 1.5, tailAmp: 0.2,  headPitch: 0.9,  scale: 1,    arch: 0.15, jitter: 0,   crouch: 0.2, breathe: 3 },
  // CatMood：
  purr:    { step: 0,  legSwing: 0,    bodyY: 0.05, bob: 0,    tailWag: 1,   tailAmp: 0.3,  headPitch: -0.05,scale: 1.02, arch: 0,    jitter: 0.4, crouch: 0.3, breathe: 4 },
  loaf:    { step: 0,  legSwing: 0,    bodyY: -0.12,bob: 0,    tailWag: 0.4, tailAmp: 0.08, headPitch: 0.1,  scale: 1,    arch: 0,    jitter: 0,   crouch: 1,   breathe: 1.4 },
  floof:   { step: 0,  legSwing: 0,    bodyY: 0.08, bob: 0,    tailWag: 8,   tailAmp: 0.6,  headPitch: -0.2, scale: 1.18, arch: 0.7,  jitter: 1.2, crouch: 0,   breathe: 5 },
  judge:   { step: 0,  legSwing: 0,    bodyY: 0.1,  bob: 0,    tailWag: 0.6, tailAmp: 0.45, headPitch: -0.25,scale: 1,    arch: 0,    jitter: 0,   crouch: 0.2, breathe: 1.8 },
};

// 暖橘虎斑配色。
const FUR = '#e8a25c';
const FUR_DARK = '#d4863c';
const BELLY = '#f6e0c4';
const EAR_IN = '#f3b3a0';
const NOSE = '#d96b6b';

function CatModel({ behavior }: { behavior: ReturnType<typeof useCatBehavior> }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
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
    if (body.current) {
      const bob = cur.bob > 0 ? Math.abs(Math.sin(tNow * cur.step)) * cur.bob : 0;
      body.current.position.y = cur.bodyY + bob + jit;
      body.current.rotation.x = -cur.arch; // 负=弓背向上拱
      const s = cur.scale + breath;
      body.current.scale.setScalar(s);
      // 趴/猫面包：身体压扁。
      body.current.scale.y = (cur.scale + breath) * (1 - cur.crouch * 0.35);
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
      {/* body：旋转/缩放支点在身体中心，离地约 0.5 */}
      <group ref={body} position={[0, 0.5, 0]}>
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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Cat3DScene = forwardRef<Cat3DHandle, {}>(function Cat3DScene(_props, ref) {
  const behavior = useCatBehavior();
  useImperativeHandle(ref, () => ({ react: behavior.react }), [behavior.react]);

  return (
    <div className="cat-3d-stage">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 3.2, 7.5], fov: 38 }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
      >
        {/* 暖色室内光（纯本地光，无远程 HDR）：半球光柔和环境 + 斜射主光投影 + 暖补光 */}
        <hemisphereLight args={['#fff4e2', '#caa376', 0.9]} />
        <ambientLight intensity={0.45} />
        <directionalLight
          position={[4, 8, 5]}
          intensity={1.9}
          color="#fff2dd"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-8}
          shadow-camera-right={8}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
        />
        <directionalLight position={[-5, 3, -4]} intensity={0.5} color="#ffd9a8" />

        {/* 木地板 */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[24, 16]} />
          <meshStandardMaterial color="#e0b67f" roughness={0.9} />
        </mesh>
        {/* 地毯（judge 道具感，中央） */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0.6]} receiveShadow>
          <circleGeometry args={[2.6, 48]} />
          <meshStandardMaterial color="#e88f86" roughness={1} />
        </mesh>
        {/* 阳光斑（左侧，发光面片） */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3, 0.01, 0.3]}>
          <circleGeometry args={[1.7, 40]} />
          <meshBasicMaterial color="#ffe9a8" transparent opacity={0.5} />
        </mesh>
        {/* 饭碗（右侧） */}
        <mesh position={[2.6, 0.12, 0.6]} castShadow>
          <cylinderGeometry args={[0.42, 0.32, 0.22, 24]} />
          <meshStandardMaterial color="#6fb6d6" roughness={0.5} />
        </mesh>

        <CatModel behavior={behavior} />
        <ContactShadows position={[0, 0.005, 0]} opacity={0.4} scale={14} blur={2.2} far={5} />
      </Canvas>
    </div>
  );
});

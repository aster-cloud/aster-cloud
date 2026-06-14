'use client';

import { useRef, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { CatMood } from '@/config/cat-mood';
import { useCatBehavior, type CatPose } from './use-cat-behavior';

/**
 * 3D 真实猫场景：Three.js + R3F 加载 CC0 rigged 模型（public/models/critter.gltf =
 * Quaternius Fox，小型猫科形态四足动物），用 useCatBehavior 状态机驱动——把 2D 行为
 * （pose/x/y）映射成 3D 位置 + 动画 clip + 朝向。真 3D 光照/接触阴影/平滑过渡。
 *
 * WebGL 不能 SSR：本组件由父级 dynamic(ssr:false) 加载。CSP 安全（WebGL 不走 eval）。
 *
 * pose → glTF clip 映射（Fox 的 clip 集）：
 *   walk→Walk, sit/idle→Idle, groom→Idle_2_HeadLow, stretch→Jump_ToIdle, sleep→Idle_2,
 *   eat→Eating, purr→Idle_2(满足), loaf→Idle_2(趴), floof→Attack(炸毛/弓背), judge→Idle_HitReact1
 */
const MODEL_URL = '/models/critter.gltf';
useGLTF.preload(MODEL_URL);

const CLIP_FOR: Record<CatPose, string> = {
  walk: 'Walk',
  sit: 'Idle',
  groom: 'Idle_2_HeadLow',
  stretch: 'Jump_ToIdle',
  sleep: 'Idle_2',
  eat: 'Eating',
  purr: 'Idle_2',
  loaf: 'Idle_2',
  floof: 'Attack',
  judge: 'Idle_HitReact1',
};

export interface Cat3DHandle {
  react: (mood: CatMood) => void;
}

// 把舞台百分比坐标 (x:0..100, y:0..100) 映射到 3D 地面 (X 横向, Z 纵深)。
function toWorld(x: number, y: number): [number, number] {
  const wx = (x - 50) / 100 * 9;        // -4.5..4.5
  const wz = (y - 80) / 100 * 6 + 0.5;  // y 越大越靠前（z 正向朝镜头）
  return [wx, wz];
}

function CatModel({ behavior }: { behavior: ReturnType<typeof useCatBehavior> }) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(MODEL_URL);
  // 克隆，避免多实例共享骨架。
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const { actions, mixer } = useAnimations(animations, group);
  const { state } = behavior;

  // 当前目标世界坐标 + 朝向（角色平滑移动/转身，而非瞬移）。
  const target = useRef(new THREE.Vector3(0, 0, 0.5));
  const targetYaw = useRef(0);
  const curClip = useRef<string>('');

  // pose 变化 → 切动画 clip（交叉淡入）。
  useEffect(() => {
    const clip = CLIP_FOR[state.pose] ?? 'Idle';
    if (clip === curClip.current) return;
    const next = actions[clip] ?? actions['Idle'];
    const prev = curClip.current ? actions[curClip.current] : null;
    if (next) {
      next.reset().fadeIn(0.25).play();
      if (prev && prev !== next) prev.fadeOut(0.25);
      curClip.current = clip;
    }
  }, [state.pose, actions]);

  // 目标位置 + 朝向随 state 更新（行进朝向 = 移动方向；非移动时面向镜头偏侧）。
  useEffect(() => {
    const [wx, wz] = toWorld(state.x, state.y);
    target.current.set(wx, 0, wz);
    // facing: 1=右(+X) → yaw 朝 +X；-1=左 → 朝 -X。模型默认朝 +Z，转到侧向。
    targetYaw.current = state.facing === 1 ? Math.PI / 2 : -Math.PI / 2;
  }, [state.x, state.y, state.facing]);

  // 每帧：mixer 推进 + 平滑插值位置/转身。
  useFrame((_, dt) => {
    mixer.update(dt);
    const g = group.current;
    if (!g) return;
    // 位置平滑趋近（lerp），walk 时趋近快。
    const speed = state.pose === 'walk' ? 2.4 : 6;
    g.position.lerp(target.current, Math.min(1, dt * speed));
    // 朝向平滑（最短角差）。
    let d = targetYaw.current - g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.rotation.y += d * Math.min(1, dt * 6);
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={cloned} scale={1.1} />
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
        {/* 暖色室内光：环境 + 斜射主光（投影）+ 暖补光（窗光感） */}
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[4, 8, 5]} intensity={1.6} color="#fff2dd"
          castShadow shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8}
        />
        <directionalLight position={[-5, 3, -4]} intensity={0.4} color="#ffd9a8" />

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
        <Environment preset="apartment" />
      </Canvas>
    </div>
  );
});

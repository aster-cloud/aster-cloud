'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { CatMood } from '@/config/cat-mood';

/**
 * 活猫行为状态机——让猫在布景里像真猫一样自主游荡，规则运行时打断去做心情响应。
 *
 * 平时（idle 循环）：随机选一个落脚点 → 走过去（walk）→ 到达后随机挑一个小动作
 * （sit 坐 / groom 舔爪 / stretch 伸懒腰 / sleep 打盹）停一会 → 再选下一个点。
 * 朝向随移动方向翻转。眨眼/尾摆/耳动是独立的随机微动（在 CSS 层，由 pose 不影响）。
 *
 * 运行规则时：react(mood) 把猫引向相关道具（炸毛=原地、呼噜=饭碗、猫面包=阳光斑、
 * 高冷=地毯中央），到位后摆出该心情 pose 数秒，然后回到 idle 游荡。
 *
 * 坐标用 0..100 的舞台百分比（布景容器内定位）。纯 setTimeout 调度，组件卸载清理。
 */

export type CatPose = 'walk' | 'sit' | 'groom' | 'stretch' | 'sleep' | CatMood;

export interface CatState {
  x: number;          // 0..100（舞台宽百分比）
  y: number;          // 0..100（舞台高百分比，猫脚位置）
  facing: 1 | -1;     // 1=朝右, -1=朝左
  pose: CatPose;
  /** 当前是否在「规则响应」中（用于 UI 提示/锁定）。 */
  reacting: boolean;
}

// 落脚点候选（地板活动区，避开家具）。y 是猫站立的地面线附近。
const ROAM_SPOTS: { x: number; y: number }[] = [
  { x: 22, y: 78 }, { x: 40, y: 82 }, { x: 58, y: 79 },
  { x: 74, y: 83 }, { x: 50, y: 76 }, { x: 30, y: 84 },
];
// 道具位置（响应时走过去）。
const PROP_POS: Record<CatMood, { x: number; y: number }> = {
  purr: { x: 76, y: 84 },   // 饭碗在右下
  loaf: { x: 30, y: 80 },   // 阳光斑在左
  judge: { x: 50, y: 80 },  // 地毯中央
  floof: { x: 50, y: 80 },  // 原地炸毛（用当前位置覆盖）
};

const IDLE_POSES: CatPose[] = ['sit', 'groom', 'stretch', 'sit', 'sleep'];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
/** 走路时长（毫秒）正比于距离，给平滑过渡用。 */
function walkDuration(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(900, Math.round(d * 70));
}

export function useCatBehavior(): {
  state: CatState;
  walkMs: number;
  react: (mood: CatMood) => void;
} {
  const [state, setState] = useState<CatState>({ x: 50, y: 80, facing: 1, pose: 'sit', reacting: false });
  const [walkMs, setWalkMs] = useState(1200);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactingRef = useRef(false);
  const posRef = useRef({ x: 50, y: 80 });

  const clear = () => { if (timer.current) clearTimeout(timer.current); };

  // 走向某点：设置朝向 + walk pose + 目标坐标 + 时长；返回到达耗时。
  const walkTo = useCallback((to: { x: number; y: number }, then: () => void) => {
    const from = posRef.current;
    const ms = walkDuration(from, to);
    setWalkMs(ms);
    setState((s) => ({ ...s, x: to.x, y: to.y, facing: to.x >= from.x ? 1 : -1, pose: 'walk' }));
    posRef.current = to;
    timer.current = setTimeout(then, ms + 60);
  }, []);

  // idle 循环：到点 → 停留摆 pose → 下一点。
  const idleLoop = useCallback(() => {
    if (reactingRef.current) return;
    const spot = pick(ROAM_SPOTS);
    walkTo(spot, () => {
      if (reactingRef.current) return;
      const pose = pick(IDLE_POSES);
      setState((s) => ({ ...s, pose }));
      // 打盹停久点，其它短些。
      const hold = pose === 'sleep' ? rand(3500, 6000) : rand(1800, 3600);
      timer.current = setTimeout(() => { if (!reactingRef.current) idleLoop(); }, hold);
    });
  }, [walkTo]);

  // 启动自主游荡（首次延迟一下，先坐着）。
  useEffect(() => {
    timer.current = setTimeout(idleLoop, 1400);
    return clear;
  }, [idleLoop]);

  // 规则响应：打断游荡 → 走向道具 → 摆心情 pose 数秒 → 回 idle。
  const react = useCallback((mood: CatMood) => {
    clear();
    reactingRef.current = true;
    setState((s) => ({ ...s, reacting: true }));
    const target = mood === 'floof' ? posRef.current : PROP_POS[mood];
    walkTo(target, () => {
      setState((s) => ({ ...s, pose: mood }));
      // 心情 pose 展示 ~5.5 秒后恢复自主游荡。
      timer.current = setTimeout(() => {
        reactingRef.current = false;
        setState((s) => ({ ...s, reacting: false, pose: 'sit' }));
        idleLoop();
      }, 5500);
    });
  }, [walkTo, idleLoop]);

  return { state, walkMs, react };
}

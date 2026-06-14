'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { CatMood } from '@/config/cat-mood';

/**
 * 活猫行为状态机——让猫在布景里像真猫一样自主游荡，规则运行时打断去做多拍心情响应。
 *
 * 平时（idle 循环）：随机选落脚点 → 走过去（walk）→ 到达后随机小动作（sit/groom/
 * stretch/sleep）停一会 → 再选下一个点。眨眼/尾摆/耳动是独立的随机微动（CSS 层）。
 *
 * 运行规则（react）：**立即中断并清空上一个响应**（取消所有计时器、重置序列），猫走向
 * 相关道具做**多拍**响应。如喂饭(purr)=走到饭碗→低头吃(eat 拍, 停顿)→吃饱呼噜；
 * 其它心情各自的走位 + pose。响应结束回到自主游荡。任意时刻点新规则都能干净切换。
 *
 * 走动「不滑行」：位移用线性时长 + walk pose 的踏步/竖直小跳，读起来像走而非漂。
 * 坐标 0..100 舞台百分比。计时器集中管理，组件卸载/中断一次清空。
 */

export type CatPose = 'walk' | 'sit' | 'groom' | 'stretch' | 'sleep' | 'eat' | CatMood;

export interface CatState {
  x: number; y: number;
  facing: 1 | -1;
  pose: CatPose;
  /** 是否在规则响应中（锁住 idle）。 */
  reacting: boolean;
  /** 移动用 transition 时长（ms），walk 时按距离算，停留时 0。 */
  moveMs: number;
}

interface Beat {
  to?: { x: number; y: number };  // 有则先走过去
  pose: CatPose;                  // 到位后的姿态
  hold: number;                   // 停留毫秒
}

const ROAM_SPOTS = [
  { x: 24, y: 80 }, { x: 42, y: 83 }, { x: 58, y: 80 },
  { x: 72, y: 84 }, { x: 50, y: 78 }, { x: 32, y: 85 },
];
const PROP_POS: Record<CatMood, { x: number; y: number }> = {
  perch: { x: 12, y: 80 },  // 爬架底座（之后渲染层把 perch pose 抬到顶窝）
  purr: { x: 74, y: 85 },   // 饭碗
  loaf: { x: 28, y: 81 },   // 阳光斑
  judge: { x: 50, y: 82 },  // 地毯中央
  floof: { x: 50, y: 82 },  // 原地（react 时用当前位置覆盖）
};
const IDLE_POSES: CatPose[] = ['sit', 'groom', 'stretch', 'sit', 'sleep'];
const WALK_SPEED = 55;   // ms/单位距离（越大越慢，配合踏步感）
const MIN_WALK = 800;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);

/** 每种心情的多拍序列（道具坐标在 buildBeats 里填，floof 用当前位置）。 */
function buildBeats(mood: CatMood, here: { x: number; y: number }): Beat[] {
  switch (mood) {
    case 'perch': // 走到爬架底座→纵身一跃→蹲在顶窝
      return [
        { to: PROP_POS.perch, pose: 'walk', hold: 250 },  // 走到爬架底
        { pose: 'perch', hold: 6000 },                     // 爬上去蹲在顶窝（渲染层抬高）
      ];
    case 'purr': // 喂饭→吃→吃饱呼噜
      return [
        { to: PROP_POS.purr, pose: 'eat', hold: 2200 },   // 走到饭碗低头吃
        { pose: 'purr', hold: 4200 },                      // 吃饱满足呼噜
      ];
    case 'loaf': // 走到阳光斑→摊成猫面包
      return [{ to: PROP_POS.loaf, pose: 'loaf', hold: 5000 }];
    case 'judge': // 走到地毯中央→端坐审视
      return [{ to: PROP_POS.judge, pose: 'judge', hold: 5000 }];
    case 'floof': // 原地炸毛（不走）
      return [{ to: here, pose: 'floof', hold: 5000 }];
  }
}

export function useCatBehavior(): { state: CatState; react: (mood: CatMood) => void } {
  const [state, setState] = useState<CatState>({ x: 50, y: 82, facing: 1, pose: 'sit', reacting: false, moveMs: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reactingRef = useRef(false);
  const posRef = useRef({ x: 50, y: 82 });

  const after = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const clearAll = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = []; }, []);

  // 走向某点，到达后回调。设置朝向 + walk pose + 距离比例时长。
  const walkTo = useCallback((to: { x: number; y: number }, then: () => void) => {
    const from = posRef.current;
    const ms = Math.max(MIN_WALK, Math.round(dist(from, to) * WALK_SPEED));
    posRef.current = to;
    setState((s) => ({ ...s, x: to.x, y: to.y, facing: to.x >= from.x ? 1 : -1, pose: 'walk', moveMs: ms }));
    after(ms + 50, then);
  }, []);

  // idle 循环：到点 → 停留摆 pose → 下一点。
  const idleLoop = useCallback(() => {
    if (reactingRef.current) return;
    walkTo(pick(ROAM_SPOTS), () => {
      if (reactingRef.current) return;
      const pose = pick(IDLE_POSES);
      setState((s) => ({ ...s, pose, moveMs: 0 }));
      const hold = pose === 'sleep' ? rand(3500, 6000) : rand(1800, 3600);
      after(hold, () => { if (!reactingRef.current) idleLoop(); });
    });
  }, [walkTo]);

  useEffect(() => {
    after(1200, idleLoop);
    return clearAll;
  }, [idleLoop, clearAll]);

  // 跑一串拍：每拍可选先走过去，再摆 pose 停 hold，然后下一拍；末拍后回 idle。
  const runBeats = useCallback((beats: Beat[], i: number) => {
    if (i >= beats.length) {
      reactingRef.current = false;
      setState((s) => ({ ...s, reacting: false, pose: 'sit', moveMs: 0 }));
      idleLoop();
      return;
    }
    const beat = beats[i];
    const enter = () => {
      setState((s) => ({ ...s, pose: beat.pose, moveMs: 0 }));
      after(beat.hold, () => runBeats(beats, i + 1));
    };
    if (beat.to) walkTo(beat.to, enter); else enter();
  }, [walkTo, idleLoop]);

  // 规则响应：**立即清空上一个响应**，从头跑新心情的多拍序列。
  const react = useCallback((mood: CatMood) => {
    clearAll();                       // 中断并清掉之前所有计时器/序列
    reactingRef.current = true;
    setState((s) => ({ ...s, reacting: true }));
    const beats = buildBeats(mood, posRef.current);
    runBeats(beats, 0);
  }, [clearAll, runBeats]);

  return { state, react };
}

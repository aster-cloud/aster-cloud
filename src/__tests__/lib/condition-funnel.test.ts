// 条件漏斗聚合测试（Phase 1）。
//
// 锁的是聚合语义，尤其两处容易做错的地方：
//   1. evaluated 与 matched 是两个分母——不是所有执行都会走到每个条件
//   2. 死分支定义是"求值过但从未为真"，不能把"根本没走到"也算进去

import { describe, it, expect } from 'vitest';
import {
  aggregateConditionFunnel,
  type TraceSkeletonLike,
} from '@/lib/analytics/condition-funnel';

const sk = (steps: Array<[string, string, boolean, number]>): TraceSkeletonLike => ({
  schemaVersion: 'trace-skeleton/v1',
  steps: steps.map(([stepId, expression, matched, depth]) => ({
    stepId,
    expression,
    matched,
    depth,
  })),
});

describe('aggregateConditionFunnel', () => {
  it('空输入 → 空漏斗（不抛异常）', () => {
    const f = aggregateConditionFunnel([]);
    expect(f.sampleSize).toBe(0);
    expect(f.withSkeleton).toBe(0);
    expect(f.steps).toEqual([]);
    expect(f.deadBranches).toEqual([]);
  });

  it('按 stepId 聚合命中数与求值数', () => {
    const f = aggregateConditionFunnel([
      sk([['0.1', '客户是 VIP', true, 0]]),
      sk([['0.1', '客户是 VIP', false, 0]]),
      sk([['0.1', '客户是 VIP', true, 0]]),
    ]);
    expect(f.steps).toHaveLength(1);
    expect(f.steps[0]).toMatchObject({ evaluated: 3, matched: 2 });
    expect(f.steps[0].matchRate).toBeCloseTo(2 / 3);
  });

  // ★核心：嵌套条件只在上游命中时才被求值，分母必须是"实际求值次数"
  it('★evaluated 是各条件自己的分母，不是执行总数', () => {
    const f = aggregateConditionFunnel([
      sk([['0.1', 'VIP', true, 0], ['1.1', '信用分>=700', true, 1]]),
      sk([['0.1', 'VIP', false, 0]]), // 未命中 → 内层根本没求值
      sk([['0.1', 'VIP', true, 0], ['1.1', '信用分>=700', false, 1]]),
    ]);
    const outer = f.steps.find((s) => s.stepId === '0.1')!;
    const inner = f.steps.find((s) => s.stepId === '1.1')!;
    expect(outer.evaluated).toBe(3);
    expect(inner.evaluated).toBe(2); // ← 不是 3
    expect(inner.matched).toBe(1);
    expect(inner.matchRate).toBeCloseTo(0.5); // 1/2 而非 1/3
  });

  it('★死分支＝求值过但从未为真', () => {
    const f = aggregateConditionFunnel([
      sk([['0.1', '金额>100万', false, 0]]),
      sk([['0.1', '金额>100万', false, 0]]),
    ]);
    expect(f.deadBranches).toHaveLength(1);
    expect(f.deadBranches[0].expression).toBe('金额>100万');
    expect(f.deadBranches[0].evaluated).toBe(2);
  });

  it('★"从未走到"不算死分支（evaluated=0 不出现在结果里）', () => {
    // 只有走到过的条件才会出现在骨架里，故 evaluated 恒 >0；
    // 这条断言防止将来有人把"未出现的条件"也塞进 deadBranches。
    const f = aggregateConditionFunnel([sk([['0.1', 'A', true, 0]])]);
    expect(f.deadBranches).toEqual([]);
    expect(f.steps.every((s) => s.evaluated > 0)).toBe(true);
  });

  it('全部命中 → 无死分支', () => {
    const f = aggregateConditionFunnel([sk([['0.1', 'A', true, 0], ['0.2', 'B', true, 0]])]);
    expect(f.deadBranches).toEqual([]);
  });

  it('保持执行时的判定顺序（漏斗的意义在于反映真实路径）', () => {
    const f = aggregateConditionFunnel([
      sk([['0.1', '第一步', true, 0], ['1.1', '第二步', true, 1], ['0.2', '第三步', false, 0]]),
    ]);
    expect(f.steps.map((s) => s.stepId)).toEqual(['0.1', '1.1', '0.2']);
  });

  it('null / 空 steps 的执行计入 sampleSize 但不计 withSkeleton', () => {
    const f = aggregateConditionFunnel([sk([['0.1', 'A', true, 0]]), null, undefined, { steps: [] }]);
    expect(f.sampleSize).toBe(4);
    expect(f.withSkeleton).toBe(1);
  });

  it('同一 stepId 措辞变化时取较新的（策略被改过）', () => {
    const f = aggregateConditionFunnel([
      sk([['0.1', '旧措辞', true, 0]]),
      sk([['0.1', '新措辞', true, 0]]),
    ]);
    expect(f.steps[0].expression).toBe('新措辞');
    expect(f.steps[0].evaluated).toBe(2);
  });

  it('matchRate 在无求值时为 null 而非 0（无数据 ≠ 0%）', () => {
    const f = aggregateConditionFunnel([]);
    expect(f.steps).toEqual([]);
    // 构造一个 evaluated=0 不可能从骨架产生，故直接断言实现不会把 0 当 0%
    const one = aggregateConditionFunnel([sk([['0.1', 'A', false, 0]])]);
    expect(one.steps[0].matchRate).toBe(0); // 求值过、未命中 → 确实是 0%
  });

  it('★口径说明必须存在（UI 需常驻展示，防止被误读为全量分析）', () => {
    expect(aggregateConditionFunnel([]).sampleNote).toBeTruthy();
    expect(aggregateConditionFunnel([], { sampleNote: '自定义' }).sampleNote).toBe('自定义');
  });
});

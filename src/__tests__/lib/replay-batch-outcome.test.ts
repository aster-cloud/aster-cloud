import { describe, it, expect } from 'vitest';
import {
  decideOutcome,
  totalFailures,
  allRetryable,
  isRetryable,
  REPLAY_FAILURE_KINDS,
  type ItemResult,
  type ReplayFailureKind,
  type CompletedOutcome,
  type RejectedOutcome,
} from '@/lib/replay-batch/outcome';

/**
 * 批次结局判定（ADR 0034 §1.1 的核心）。
 *
 * ★这个测试守的是 Phase 4 的死因：上一版允许「200 条发起、30 条成功」
 * 就对这 30 条出完整业务数字。重跑失败与输入/词汇/策略路径**相关**，
 * 剩下的成功样本不是随机子集——据此算出的数字可能方向对而幅度全错。
 *
 * 核心断言只有一条，但要从各个角度钉死：
 * **只要有一条失败，就不得出现任何数字。**
 */

const ok = (id: string, base: boolean, target: boolean, valueDelta: number | null = null): ItemResult => ({
  sourceExecutionId: id,
  baseApproved: base,
  targetApproved: target,
  valueDelta,
  failureKind: null,
});

const failed = (id: string, kind: ReplayFailureKind): ItemResult => ({
  sourceExecutionId: id,
  baseApproved: false,
  targetApproved: false,
  valueDelta: null,
  failureKind: kind,
});

const allOk = (n: number): ItemResult[] =>
  Array.from({ length: n }, (_, i) => ok(`e${i}`, true, true));

describe('批次结局判定（ADR 0034 §1.1）', () => {
  describe('核心：任一失败即整批拒答', () => {
    it('★199/200 成功也必须拒答——成功子集不是随机样本', () => {
      // 这正是 Phase 4 的场景。上一版会对那 199 条出数字。
      const results = [...allOk(199), failed('e199', 'INPUT_INCOMPATIBLE')];
      const outcome = decideOutcome(200, results);

      expect(outcome.kind).toBe('rejected');
      expect((outcome as RejectedOutcome).failuresByKind.INPUT_INCOMPATIBLE).toBe(1);
    });

    it.each(REPLAY_FAILURE_KINDS)('任何一类失败都导致拒答：%s', (kind) => {
      const results = [...allOk(9), failed('bad', kind)];
      expect(decideOutcome(10, results).kind).toBe('rejected');
    });

    it('★拒答结局在类型层面就拿不出业务数字', () => {
      // Rejected 根本没有 changed/newlyApproved 字段——不是填 0，是不存在。
      // 给了前端就会自行算比率，那正是 §1.1 要防的。
      const outcome = decideOutcome(5, [...allOk(4), failed('x', 'TIMEOUT')]);
      const keys = Object.keys(outcome);

      expect(keys).not.toContain('changed');
      expect(keys).not.toContain('newlyApproved');
      expect(keys).not.toContain('newlyRejected');
      expect(keys).not.toContain('totalSampled');
      expect(keys).not.toContain('estimatedValueDelta');
      expect(keys).not.toContain('successCount');
      expect(keys).not.toContain('partialCount');
    });

    it('多类失败的分布如实回报', () => {
      // 「失败了」不够——用户要知道是自己数据的问题还是服务端繁忙
      const results = [
        ...allOk(5),
        failed('a', 'INPUT_INCOMPATIBLE'),
        failed('b', 'INPUT_INCOMPATIBLE'),
        failed('c', 'TIMEOUT'),
      ];
      const r = decideOutcome(8, results) as RejectedOutcome;

      expect(r.failuresByKind.INPUT_INCOMPATIBLE).toBe(2);
      expect(r.failuresByKind.TIMEOUT).toBe(1);
      expect(totalFailures(r)).toBe(3);
      expect(allRetryable(r)).toBe(false);
    });

    it('全部可重试类失败才标记为可重试', () => {
      const results = [...allOk(2), failed('a', 'TIMEOUT'), failed('b', 'THROTTLED')];
      expect(allRetryable(decideOutcome(4, results) as RejectedOutcome)).toBe(true);
    });

    it('★THROTTLED 与 INPUT_INCOMPATIBLE 的可重试性必须不同', () => {
      // 服务端繁忙 vs 用户数据有问题——混为一谈会让用户去改自己没错的数据
      expect(isRetryable('THROTTLED')).toBe(true);
      expect(isRetryable('INPUT_INCOMPATIBLE')).toBe(false);
    });
  });

  describe('完整性：少一条都不算跑完', () => {
    it('★条数不足时抛出而非降级为拒答', () => {
      // 降级会把「worker 有 bug」伪装成「用户数据有问题」，掩盖真正的缺陷
      expect(() => decideOutcome(10, allOk(7))).toThrow(/7.*10|10.*7/);
    });

    it('条数超出同样抛出', () => {
      expect(() => decideOutcome(3, allOk(5))).toThrow();
    });

    it('★空结果不得被判成功', () => {
      // 「零条执行也算全量成功」是最危险的一种假成功
      expect(() => decideOutcome(5, [])).toThrow();
    });

    it('plannedCount 非正数时抛出', () => {
      expect(() => decideOutcome(0, [])).toThrow(/正整数/);
      expect(() => decideOutcome(-1, [])).toThrow(/正整数/);
    });
  });

  describe('全量成功路径', () => {
    it('样本即全量，翻转分别计数', () => {
      const results = [
        ok('e1', true, true),
        ok('e2', true, false), // 通过 → 拒绝
        ok('e3', false, true), // 拒绝 → 通过
        ok('e4', false, false),
      ];
      const c = decideOutcome(4, results) as CompletedOutcome;

      expect(c.totalSampled).toBe(4);
      expect(c.changed).toBe(2);
      expect(c.newlyRejected).toBe(1);
      expect(c.newlyApproved).toBe(1);
    });

    it('★无金额基线时保持 null 而非 0', () => {
      // 「无法估算」与「估算为零」是两回事。渲染成 0 会被读成
      // 「换版本没有金额影响」——一个没有依据的结论。
      const c = decideOutcome(2, [ok('e1', true, false), ok('e2', true, true)]) as CompletedOutcome;
      expect(c.estimatedValueDelta).toBeNull();
    });

    it('有金额基线时只累加变化条目', () => {
      const c = decideOutcome(3, [
        ok('e1', true, false, -100.5),
        ok('e2', false, true, 200.25),
        ok('e3', true, true, 999), // 未变化 → 不计入
      ]) as CompletedOutcome;

      expect(c.estimatedValueDelta).toBeCloseTo(99.75, 2);
      expect(c.changed).toBe(2);
    });

    it('全部未变化时 changed=0 但仍是 completed', () => {
      const c = decideOutcome(3, allOk(3)) as CompletedOutcome;
      expect(c.kind).toBe('completed');
      expect(c.changed).toBe(0);
      expect(c.totalSampled).toBe(3);
    });
  });
});

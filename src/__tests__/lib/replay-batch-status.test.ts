import { describe, it, expect } from 'vitest';
import {
  REPLAY_BATCH_STATUSES,
  canTransition,
  requireTransition,
  isTerminal,
  isActive,
  allowsResult,
  type ReplayBatchStatus,
} from '@/lib/replay-batch/status';

/**
 * 批次状态机（ADR 0034 §3.1）。
 *
 * ★上一版 Phase 4 死于「部分成功被当成全量」。在异步模型里那个错误会以
 * 「没跑完就标 COMPLETED」的形式重现，而这一步只要有一处代码写错就会发生。
 * 故这里穷举**全部** 5×5 迁移组合，逐一与规则表比对。
 */

/** 合法迁移的完整集合——改这张表就等于改 ADR 0034 §3.1。 */
const LEGAL = new Set([
  'PENDING->RUNNING',
  'PENDING->FAILED', // 开跑前即失败：目标版本被删、窗口内零条可重跑
  'RUNNING->COMPLETED',
  'RUNNING->FAILED',
  'COMPLETED->EXPIRED',
  'FAILED->EXPIRED',
]);

describe('批次状态机（ADR 0034 §3.1）', () => {
  it('★穷举全部 5×5 迁移组合，与规则表逐一比对', () => {
    for (const from of REPLAY_BATCH_STATUSES) {
      for (const to of REPLAY_BATCH_STATUSES) {
        const expected = LEGAL.has(`${from}->${to}`);
        expect(canTransition(from, to), `${from} → ${to} 应${expected ? '' : '**不**'}合法`).toBe(
          expected,
        );
      }
    }
  });

  it.each(REPLAY_BATCH_STATUSES)('自迁移一律非法：%s', (s) => {
    // ★幂等应由条件更新（WHERE status = ?）表达，不能让状态机默许——
    //   否则「重复标记完成」这类 bug 会被掩盖。
    expect(canTransition(s, s)).toBe(false);
  });

  it.each(REPLAY_BATCH_STATUSES)('null/undefined 目标一律非法：%s', (s) => {
    expect(canTransition(s, null)).toBe(false);
    expect(canTransition(s, undefined)).toBe(false);
  });

  it('★PENDING 不得直接跳到 COMPLETED', () => {
    // 没跑过就没有「全量成功」可言——§1.1 的直接推论
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false);
  });

  it('★EXPIRED 是绝对终态', () => {
    for (const to of REPLAY_BATCH_STATUSES) {
      expect(canTransition('EXPIRED', to)).toBe(false);
    }
  });

  it('requireTransition 非法时抛出且带上下文', () => {
    expect(() => requireTransition('COMPLETED', 'RUNNING')).toThrow(/COMPLETED.*RUNNING/);
  });

  it('requireTransition 合法时不抛', () => {
    expect(() => requireTransition('PENDING', 'RUNNING')).not.toThrow();
  });

  describe('状态属性', () => {
    it('★只有 COMPLETED 允许携带数字', () => {
      for (const s of REPLAY_BATCH_STATUSES) {
        expect(allowsResult(s), `${s} 是否允许携带聚合结果`).toBe(s === 'COMPLETED');
      }
    });

    it('★只有 PENDING 与 RUNNING 占并发额度', () => {
      // 并发上限（§7.2）只数活跃批次；终态不该继续占额度
      const active: ReplayBatchStatus[] = ['PENDING', 'RUNNING'];
      for (const s of REPLAY_BATCH_STATUSES) {
        expect(isActive(s), `${s} 是否占并发额度`).toBe(active.includes(s));
      }
    });

    it('终态判定', () => {
      const terminal: ReplayBatchStatus[] = ['COMPLETED', 'FAILED', 'EXPIRED'];
      for (const s of REPLAY_BATCH_STATUSES) {
        expect(isTerminal(s), `${s} 是否终态`).toBe(terminal.includes(s));
      }
    });
  });
});

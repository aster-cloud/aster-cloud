/**
 * What-If 批次状态机（ADR 0034 §3.1）。
 *
 * ★为什么把迁移规则写成代码而不是靠调用方自觉：
 * 上一版 Phase 4 的死因是「部分成功被当成全量」。在异步模型里，
 * 这个错误会以「批次还没跑完就被标成 COMPLETED」的形式重现——
 * 而那一步只要有一处代码写错就会发生。故把合法迁移收敛到这里，
 * 任何非法迁移抛异常，不静默放行。
 *
 * ```
 *   PENDING ──→ RUNNING ──┬─→ COMPLETED ──→ EXPIRED
 *      │                  └─→ FAILED    ──→ EXPIRED
 *      └────────────────────→ FAILED
 * ```
 *
 * 注意 `PENDING → FAILED` 合法：批次可能在**开跑之前**就失败
 * （目标版本已删除、窗口内零条可重跑执行）。
 * 而 `PENDING → COMPLETED` **非法**——没跑过就没有全量成功可言。
 */
export const REPLAY_BATCH_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
] as const;

export type ReplayBatchStatus = (typeof REPLAY_BATCH_STATUSES)[number];

/**
 * 合法迁移表。改这张表就等于改 ADR 0034 §3.1，应当是有意识的动作。
 */
const LEGAL_TRANSITIONS: Readonly<Record<ReplayBatchStatus, readonly ReplayBatchStatus[]>> = {
  PENDING: ['RUNNING', 'FAILED'],
  RUNNING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['EXPIRED'],
  FAILED: ['EXPIRED'],
  EXPIRED: [],
};

/** 终态：不可再迁移到 EXPIRED 以外的状态。 */
export function isTerminal(s: ReplayBatchStatus): boolean {
  return s === 'COMPLETED' || s === 'FAILED' || s === 'EXPIRED';
}

/**
 * 是否占用并发额度（ADR 0034 §7.2 的并发上限只数这两个）。
 */
export function isActive(s: ReplayBatchStatus): boolean {
  return s === 'PENDING' || s === 'RUNNING';
}

/** 是否允许携带聚合结果。**仅 COMPLETED**。 */
export function allowsResult(s: ReplayBatchStatus): boolean {
  return s === 'COMPLETED';
}

/**
 * 是否允许迁移。
 *
 * ★同状态自迁移一律**不允许**——幂等应由调用方用条件更新
 * （`WHERE status = ?`）表达，而不是让状态机默许，
 * 否则「重复标记完成」这类 bug 会被掩盖。
 */
export function canTransition(from: ReplayBatchStatus, to: ReplayBatchStatus | null | undefined): boolean {
  if (!to || to === from) return false;
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * 校验迁移合法性，非法则抛出（含具体状态，便于定位）。
 */
export function requireTransition(from: ReplayBatchStatus, to: ReplayBatchStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`非法的批次状态迁移：${from} → ${to}`);
  }
}

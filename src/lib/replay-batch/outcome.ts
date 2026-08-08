/**
 * 批次结局与判定（ADR 0034 §1.1 的核心）。
 *
 * ★这个模块守的是 Phase 4 的死因：上一版允许「200 条发起、30 条成功」
 * 就对这 30 条出完整业务数字。重跑失败与输入/词汇/策略路径**相关**，
 * 剩下的成功样本不是随机子集——据此算出的数字可能方向对而幅度全错。
 */

/**
 * 失败分类（ADR 0034 §4.2）。
 *
 * ★分类是**面向用户决策**的，不是面向异常类型的——
 * 批次 fail-closed，用户面对的是「没有数字」，此时唯一有用的信息是
 * **为什么**：是自己的数据有问题（清理后可重跑），还是版本不兼容（重跑无用）。
 * 只说「失败」会让用户反复重试注定失败的事。
 */
export const REPLAY_FAILURE_KINDS = [
  /** 目标版本源码编译失败。重跑无用。 */
  'TARGET_COMPILE_ERROR',
  /**
   * 历史输入在目标版本上求值失败。
   * ★最常见，也是**选择偏差的源头**——它与输入内容强相关，
   * 故绝不能「跳过失败的、只算成功的」。
   */
  'INPUT_INCOMPATIBLE',
  /** 词汇/别名快照缺失或加载失败。 */
  'VOCABULARY_UNAVAILABLE',
  /** 执行超时。可重试。 */
  'TIMEOUT',
  /**
   * 并发闸门拒绝（服务端繁忙）。可重试。
   * ★这**不是**用户数据的问题，文案上必须与 INPUT_INCOMPATIBLE 区分，
   * 否则用户会去改自己没错的数据。
   */
  'THROTTLED',
  /** 未归类。★这一类占比高本身就是信号：说明分类不够细，该补而不是放着。 */
  'UNKNOWN',
] as const;

export type ReplayFailureKind = (typeof REPLAY_FAILURE_KINDS)[number];

const RETRYABLE: ReadonlySet<ReplayFailureKind> = new Set(['TIMEOUT', 'THROTTLED']);

export function isRetryable(kind: ReplayFailureKind): boolean {
  return RETRYABLE.has(kind);
}

/** 单条重跑结果。`failureKind` 非空即表示这一条失败。 */
export interface ItemResult {
  sourceExecutionId: string;
  baseApproved: boolean;
  targetApproved: boolean;
  /** 业务价值变化；无金额基线时为 null（★不是 0）。 */
  valueDelta: number | null;
  failureKind: ReplayFailureKind | null;
}

/**
 * 全量成功。**只有这一种结局携带数字。**
 */
export interface CompletedOutcome {
  kind: 'completed';
  changed: number;
  newlyApproved: number;
  newlyRejected: number;
  /** 样本总数 = plannedCount，即全量。 */
  totalSampled: number;
  /**
   * 业务价值变化估算；无金额基线时为 **null**。
   * ★「无法估算」与「估算为零」是两回事——渲染成 0 会被读成
   * 「换版本没有金额影响」，一个没有依据的结论。
   */
  estimatedValueDelta: number | null;
}

/**
 * 拒答。**不携带任何会被读成结论的数字。**
 *
 * ★这里刻意**没有** partialCount / successCount 之类的字段：
 * 给了前端就会自行计算比率，那正是 §1.1 要防的。
 * 唯一的数字是失败原因分布——它描述「哪里出了问题」，
 * 不是「业务影响是多少」。
 */
export interface RejectedOutcome {
  kind: 'rejected';
  failuresByKind: Readonly<Partial<Record<ReplayFailureKind, number>>>;
}

export type ReplayBatchOutcome = CompletedOutcome | RejectedOutcome;

/** 失败总条数。仅用于日志与运维，**不得**回传前端做比率计算。 */
export function totalFailures(r: RejectedOutcome): number {
  return Object.values(r.failuresByKind).reduce((a, b) => a + (b ?? 0), 0);
}

/** 是否全部失败都可重试——决定 UI 是否提示重试。 */
export function allRetryable(r: RejectedOutcome): boolean {
  const keys = Object.keys(r.failuresByKind) as ReplayFailureKind[];
  return keys.length > 0 && keys.every(isRetryable);
}

/**
 * 由逐条结果判定批次结局。
 *
 * **判定规则（不可放宽）**：
 * 1. 结果条数必须等于 `plannedCount`——少一条都不算跑完。
 *    这堵住「worker 提前退出后被当成完成」这条路径。
 * 2. 任一条失败 → `rejected`，**不出任何数字**。
 * 3. 全部成功 → `completed`，样本即全量。
 *
 * @throws 结果条数与计划不符时抛出——这是**编程错误**而非业务失败，
 *         降级为 rejected 会把「worker 有 bug」伪装成「用户数据有问题」，
 *         掩盖真正的缺陷。宁可炸掉让人看见。
 */
export function decideOutcome(plannedCount: number, results: readonly ItemResult[]): ReplayBatchOutcome {
  if (results === null || results === undefined) {
    throw new Error('结果列表不得为空引用');
  }
  if (!Number.isInteger(plannedCount) || plannedCount <= 0) {
    throw new Error(`计划条数必须为正整数：${plannedCount}`);
  }
  if (results.length !== plannedCount) {
    throw new Error(
      `结果条数 ${results.length} 与计划 ${plannedCount} 不符——批次未完整执行，不得判定结局`,
    );
  }

  const failures: Partial<Record<ReplayFailureKind, number>> = {};
  for (const r of results) {
    if (r.failureKind) {
      failures[r.failureKind] = (failures[r.failureKind] ?? 0) + 1;
    }
  }

  // ★任一失败即整批拒答。这一步**没有阈值、没有容忍度旋钮**——
  //   上一版正是靠一个可调阈值放行了 30/200 的成功子集。
  if (Object.keys(failures).length > 0) {
    return { kind: 'rejected', failuresByKind: Object.freeze(failures) };
  }

  let changed = 0;
  let newlyApproved = 0;
  let newlyRejected = 0;
  let delta: number | null = null;

  for (const r of results) {
    if (r.baseApproved !== r.targetApproved) {
      changed++;
      if (r.targetApproved) newlyApproved++;
      else newlyRejected++;
      // ★金额基线缺失时保持 null 而非累加 0
      if (r.valueDelta !== null && r.valueDelta !== undefined) {
        delta = (delta ?? 0) + r.valueDelta;
      }
    }
  }

  return {
    kind: 'completed',
    changed,
    newlyApproved,
    newlyRejected,
    totalSampled: plannedCount,
    estimatedValueDelta: delta,
  };
}

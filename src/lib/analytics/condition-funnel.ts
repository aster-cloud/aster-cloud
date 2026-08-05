/**
 * 条件漏斗聚合（Phase 1）——纯函数，无 DB / 无 React。
 *
 * <p>把一批 {@link TraceSkeletonLike} 聚合成业务人员看得懂的漏斗：
 * 每个条件被判定为真的次数、占比，以及**从未命中过的条件**（死分支）。
 *
 * <p><b>为什么它是零 PII 的</b>：骨架里只有条件原文（策略源码片段）与布尔
 * 判定，没有任何字段值。聚合只做计数，不碰业务数据。因此本能力对**全部租户**
 * 可用，不受 `replayRetentionEnabled`（默认关）门控。
 *
 * <p><b>★样本口径</b>：分母是"平台记录到的执行"，**不是客户的全量业务数据**。
 * 平台不持有客户订单/客户/交易表（见 docs/strategy-replay-gap-analysis.md 第二节）。
 * {@link ConditionFunnel.sampleNote} 必须被 UI 常驻展示——不加标注地呈现漏斗，
 * 会让业务人员误以为是全量分析，这在风控场景下是危险误导。
 *
 * <p>抽成纯函数是为了能脱离 DB 逐条断言聚合语义（见同名 .test.ts）。
 */

/** 骨架步骤（与 aster-api TraceSkeleton.SkeletonStep 对齐；★无 result 字段）。 */
export interface SkeletonStepLike {
  stepId: string;
  expression: string;
  matched: boolean;
  depth: number;
}

/** 单次执行的骨架。 */
export interface TraceSkeletonLike {
  schemaVersion?: string;
  moduleName?: string | null;
  functionName?: string | null;
  steps: SkeletonStepLike[];
}

/** 聚合后的单个条件。 */
export interface FunnelStep {
  stepId: string;
  /** 条件原文（策略源码片段）。 */
  expression: string;
  depth: number;
  /** 该条件被**求值**过的次数（分母：不是所有执行都会走到每个条件）。 */
  evaluated: number;
  /** 其中判定为真的次数。 */
  matched: number;
  /** matched / evaluated，evaluated=0 时为 null（不是 0——无数据 ≠ 0%）。 */
  matchRate: number | null;
}

export interface ConditionFunnel {
  /** 参与聚合的执行条数。 */
  sampleSize: number;
  /** 其中带骨架的条数——两者不等说明部分执行未采集到骨架。 */
  withSkeleton: number;
  /** ★口径说明，UI 必须展示。 */
  sampleNote: string;
  steps: FunnelStep[];
  /**
   * 死分支：被求值过但**从未**判定为真的条件。
   *
   * <p>这是对业务人员最直观的价值——"你写的这个条件在 N 次执行里从未命中过"，
   * 往往意味着规则写错了、或者上游条件把它挡住了。
   */
  deadBranches: FunnelStep[];
}

/** 口径说明的固定文案 key（UI 走 i18n，这里给出稳定标识）。 */
export const SAMPLE_NOTE_KEY = 'analytics.funnel.sampleNote';

/**
 * 聚合一批骨架。
 *
 * <p>按 `stepId` 分组——它在 aster-api 侧构造为 `<depth>.<sequence>`，
 * 同一策略跨执行稳定，故可直接对齐。若同一 stepId 在不同执行里 expression
 * 不同（策略被改过），取**最后出现**的那个：新版本的措辞更贴近当前策略。
 *
 * <p>顺序按首次出现顺序（即执行时的实际判定顺序），不排序——漏斗的价值
 * 就在于反映真实的决策路径。
 */
export function aggregateConditionFunnel(
  skeletons: ReadonlyArray<TraceSkeletonLike | null | undefined>,
  opts: { sampleNote?: string } = {},
): ConditionFunnel {
  const order: string[] = [];
  const acc = new Map<string, FunnelStep>();
  let withSkeleton = 0;

  for (const sk of skeletons) {
    if (!sk || !Array.isArray(sk.steps) || sk.steps.length === 0) continue;
    withSkeleton++;
    for (const step of sk.steps) {
      if (!step || typeof step.stepId !== 'string') continue;
      let cur = acc.get(step.stepId);
      if (!cur) {
        cur = {
          stepId: step.stepId,
          expression: step.expression,
          depth: step.depth,
          evaluated: 0,
          matched: 0,
          matchRate: null,
        };
        acc.set(step.stepId, cur);
        order.push(step.stepId);
      }
      // 策略改过措辞时以较新的为准（见函数注释）
      cur.expression = step.expression;
      cur.evaluated++;
      if (step.matched) cur.matched++;
    }
  }

  const steps = order.map((id) => {
    const s = acc.get(id)!;
    return { ...s, matchRate: s.evaluated > 0 ? s.matched / s.evaluated : null };
  });

  return {
    sampleSize: skeletons.length,
    withSkeleton,
    sampleNote: opts.sampleNote ?? SAMPLE_NOTE_KEY,
    steps,
    // 死分支：求值过但从未为真。evaluated=0 的不算——那是"没走到"，不是"走到了但不成立"。
    deadBranches: steps.filter((s) => s.evaluated > 0 && s.matched === 0),
  };
}

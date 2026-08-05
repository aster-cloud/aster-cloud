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
 * <p><b>★分组键是 `stepId + expression`，不是单独的 stepId。</b>
 *
 * <p>原因（生产数据实证）：stepId 是 `<depth>.<sequence>`，即**执行序号**而非
 * 源码位置。分支型策略在不同输入下走不同路径，同一个 stepId 会落到**不同的
 * 源码节点**上。实测某生产策略 20 次执行产生 3 种形态，其 `0.1` 分别是
 * `if condition` / `return value` / `match no-arm` 三种节点——只按 stepId 分组
 * 会把它们静默混成一条，得出的命中率毫无意义。
 *
 * <p>联合 expression 后：不同节点各自成组，语义正确。待引擎补上真实源码文本
 * （见 Core IR span ADR）后，分组会自动变得更精确，本函数无需再改。
 *
 * <p><b>已知局限</b>：当前引擎的 expression 是占位符（`if condition` 等），
 * 故同类型的不同条件仍会被合并。这是**引擎侧的信息缺失**，不是本函数能修的——
 * 但至少不会再把 if 和 return 混为一谈。
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
      // ★复合键：见函数注释。仅用 stepId 会把不同路径下的不同节点混为一组。
      const key = `${step.stepId}\u0000${step.expression}`;
      let cur = acc.get(key);
      if (!cur) {
        cur = {
          stepId: step.stepId,
          expression: step.expression,
          depth: step.depth,
          evaluated: 0,
          matched: 0,
          matchRate: null,
        };
        acc.set(key, cur);
        order.push(key);
      }
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

/**
 * What-if 影响估算（Phase 4）——纯函数，无 DB / 无 React。
 *
 * <p>把「决策变化」× 「历史 outcome」折算成业务指标的估计变化，回答
 * "把门槛从 500 改成 300，收入会怎样"。
 *
 * <p><b>★这是估算，不是预测。</b>它建立在一个明确假设上：
 *
 * <blockquote>决策相同 ⇒ 业务结果相同。</blockquote>
 *
 * 即「若这笔申请当初被批准了，它的结局会和历史上其它被批准的申请**同分布**」。
 * 该假设：
 * <ul>
 *   <li>在<b>风控/信贷</b>较成立——坏账主要由借款人属性决定，与"谁批的"关系不大</li>
 *   <li>在<b>广告/竞价</b>较弱——改出价会引发对手反应，市场会反馈</li>
 *   <li>在<b>推荐/定价</b>介于两者之间——用户会对价格变化产生行为改变</li>
 * </ul>
 *
 * 因此 {@link WhatIfEstimate#assumption} 与 {@link WhatIfEstimate#confidence}
 * 必须随结果一起呈现。**不得**把估算数字单独拿出来做营销话术——
 * 那会把一个有前提的推断包装成承诺，对银行客户尤其危险。
 *
 * <p><b>不做的事</b>：不做置信区间/显著性检验。样本量小时给出貌似精确的
 * ±区间反而更误导；这里只给"样本够不够"的定性判断（{@link Confidence}）。
 */

/** 单条历史执行：当初的决策 + 事后回传的真实结果。 */
export interface OutcomeSample {
  executionId: string;
  /** 历史决策（如 'APPROVED' / 'REJECTED'）。 */
  decision: string;
  /** 回传的业务结局（如 'converted' / 'defaulted'）；null=未回传。 */
  outcome: string | null;
  /** 业务数值（成交额/损失额）；null=无金额语义。 */
  value: number | null;
}

/** 新策略对同一批样本的决策（executionId → 新决策）。 */
export type NewDecisions = ReadonlyMap<string, string>;

export interface WhatIfOptions {
  /** 视为"正面结局"的 outcome 集合，如 ['converted','repaid']。 */
  positiveOutcomes: readonly string[];
  /** 视为"负面结局"的集合，如 ['defaulted','refunded']。 */
  negativeOutcomes: readonly string[];
  /** 哪些决策算"放行"（会产生业务结果）。默认 ['APPROVED']。 */
  approveDecisions?: readonly string[];
}

export type Confidence = 'insufficient' | 'low' | 'moderate';

export interface WhatIfEstimate {
  /** 参与估算的样本总数。 */
  sampleSize: number;
  /** 其中**有 outcome 回传**的条数——这才是估算的真实依据。 */
  withOutcome: number;
  /** 决策发生变化的条数。 */
  changed: number;
  /** 新增放行（原拒绝 → 新批准）。 */
  newlyApproved: number;
  /** 新增拒绝（原批准 → 新拒绝）。 */
  newlyRejected: number;

  /** 基线：历史放行样本里正面结局占比；null=样本不足。 */
  baselinePositiveRate: number | null;
  /** 基线：历史放行样本的平均 value；null=无金额数据。 */
  baselineAvgValue: number | null;

  /**
   * 估计的 value 变化（新增放行带来的 + 新增拒绝失去的）。
   * null=缺少金额数据，无法估算——**不要用 0 代替 null**，
   * "没数据"和"没变化"是完全不同的结论。
   */
  estimatedValueDelta: number | null;

  confidence: Confidence;
  /** 假设说明，必须与数字一同呈现。 */
  assumption: string;
  /** 让结果不可靠的具体原因（样本少/无 outcome/…）。 */
  caveats: string[];
}

const ASSUMPTION =
  '本估算假设「决策相同则业务结果同分布」——即被新策略放行的申请，其结局与历史上' +
  '同样被放行的申请相似。该假设在风控/信贷较成立，在广告竞价等有市场反馈的场景较弱。' +
  '结果为估算而非预测。';

/** 样本量阈值：低于此值不给结论。经验值，宁可保守。 */
const MIN_FOR_ESTIMATE = 30;
const MIN_FOR_MODERATE = 200;

export function estimateWhatIf(
  samples: readonly OutcomeSample[],
  newDecisions: NewDecisions,
  opts: WhatIfOptions,
): WhatIfEstimate {
  const approveSet = new Set(opts.approveDecisions ?? ['APPROVED']);
  const positive = new Set(opts.positiveOutcomes);
  const negative = new Set(opts.negativeOutcomes);

  let withOutcome = 0;
  let changed = 0;
  let newlyApproved = 0;
  let newlyRejected = 0;

  // 基线只用「历史放行 且 有 outcome」的样本——被拒绝的申请没有结局可言，
  // 把它们算进分母会系统性低估正面率。
  let baseApproved = 0;
  let basePositive = 0;
  let baseValueSum = 0;
  let baseValueCount = 0;

  for (const s of samples) {
    const wasApproved = approveSet.has(s.decision);
    const nowDecision = newDecisions.get(s.executionId);
    const nowApproved = nowDecision === undefined ? wasApproved : approveSet.has(nowDecision);

    if (nowDecision !== undefined && nowDecision !== s.decision) changed++;
    if (!wasApproved && nowApproved) newlyApproved++;
    if (wasApproved && !nowApproved) newlyRejected++;

    if (s.outcome !== null) {
      withOutcome++;
      if (wasApproved) {
        baseApproved++;
        if (positive.has(s.outcome)) basePositive++;
        else if (!negative.has(s.outcome)) {
          // 既非正面也非负面的结局（如 'pending'）不计入正面率分子，
          // 但仍留在分母——它确实是一个已发生的结局。
        }
        if (s.value !== null && Number.isFinite(s.value)) {
          baseValueSum += s.value;
          baseValueCount++;
        }
      }
    }
  }

  const baselinePositiveRate = baseApproved > 0 ? basePositive / baseApproved : null;
  const baselineAvgValue = baseValueCount > 0 ? baseValueSum / baseValueCount : null;

  const caveats: string[] = [];
  if (withOutcome === 0) caveats.push('NO_OUTCOME_DATA');
  if (withOutcome > 0 && withOutcome < MIN_FOR_ESTIMATE) caveats.push('SAMPLE_TOO_SMALL');
  if (baseApproved === 0) caveats.push('NO_APPROVED_BASELINE');
  if (baselineAvgValue === null) caveats.push('NO_VALUE_DATA');

  // ★没有金额基线就返回 null，绝不用 0 顶替：
  //   "估算不出来"和"估算为零变化"是完全不同的结论，混淆会误导决策。
  const estimatedValueDelta =
    baselineAvgValue === null
      ? null
      : (newlyApproved - newlyRejected) * baselineAvgValue;

  // ★置信度必须按**真正驱动估算的样本量**（baseApproved）判定，不是 withOutcome。
  //
  // 估算的两个输出（baselinePositiveRate / baselineAvgValue）都只从「原本通过
  // 且有结局」的样本算出，与被拒样本无关。若按 withOutcome 判定，
  // 「1 条通过 + 199 条被拒」会得出 moderate——业务人员看到中等置信度，
  // 背后其实只有 1 条相关样本。分母必须与分子同源。
  const relevantSamples = Math.min(withOutcome, baseApproved);

  // 总结局数够多但相关基线太少时显式告知——否则「200 条结局」这个数字本身
  // 会让人高估结论的可靠性。
  if (withOutcome >= MIN_FOR_ESTIMATE && relevantSamples < MIN_FOR_ESTIMATE) {
    caveats.push('BASELINE_TOO_SMALL');
  }

  let confidence: Confidence = 'insufficient';
  if (relevantSamples >= MIN_FOR_MODERATE) confidence = 'moderate';
  else if (relevantSamples >= MIN_FOR_ESTIMATE) confidence = 'low';

  return {
    sampleSize: samples.length,
    withOutcome,
    changed,
    newlyApproved,
    newlyRejected,
    baselinePositiveRate,
    baselineAvgValue,
    estimatedValueDelta,
    confidence,
    assumption: ASSUMPTION,
    caveats,
  };
}

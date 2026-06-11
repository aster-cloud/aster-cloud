// 信贷风控 demo 数据：一条真实的贷款准入规则 + 三个样例申请人各自的 curated 决策回放 trace。
//
// 设计：demo 用浏览器内 TS 引擎真实编译这条规则（证明语法真可用），但「回放」用为该
// 场景手制的真实 DecisionTrace（与后端 ?trace=true 同形态），即时、无网络、叙事可控——
// 在客户面前永远不翻车。回放的内核卖点：「这一笔决策怎么算出来的，逐步给审计员看」。

import type { DecisionTrace } from '@/components/policy/decision-trace-panel';

/**
 * demo 用的信贷准入规则（CNL 源码）。
 * 真实信贷逻辑：信用分 + 负债收入比(DTI) + 申请额度三段式决策。
 */
export const CREDIT_RISK_RULE_SOURCE = `Module credit.approval.

Define Applicant has
  id as Text,
  creditScore as Int,
  monthlyIncome as Float,
  monthlyDebt as Float,
  requestedAmount as Float.

Rule decide given applicant as Applicant, produce Text:
  Let dtiRatio be applicant.monthlyDebt divided by applicant.monthlyIncome.
  If applicant.creditScore at least 740 and dtiRatio at most 0.35:
    Return "Approved — premium rate".
  Otherwise:
    If applicant.creditScore at least 660 and dtiRatio at most 0.43:
      Return "Approved — standard rate".
    Otherwise:
      If applicant.creditScore at least 600:
        Return "Refer to manual underwriting".
      Otherwise:
        Return "Declined — credit score below threshold".
`;

/** demo 申请人输入字段（可在 demo 页编辑）。 */
export interface DemoApplicant {
  id: string;
  creditScore: number;
  monthlyIncome: number;
  monthlyDebt: number;
  requestedAmount: number;
}

/** 一个 demo 场景：申请人 + 决策结果 + 可回放的 DecisionTrace。 */
export interface DemoScenario {
  /** i18n key 后缀（scenarios.<key>.label / .takeaway） */
  key: string;
  applicant: DemoApplicant;
  /** 最终决策文本（与 rule Return 一致）。 */
  decision: string;
  /** 决策语气：approved / refer / declined，用于 UI 着色。 */
  outcome: 'approved' | 'refer' | 'declined';
  /** 该笔决策的逐步回放（喂给 DecisionTracePanel）。 */
  trace: DecisionTrace;
}

// ── 三个场景：批准 / 转人工 / 拒绝，覆盖规则的三条主要路径 ──

/** 场景 A：高分低负债 → 批准优惠利率。 */
const SCENARIO_APPROVED: DemoScenario = {
  key: 'approved',
  applicant: {
    id: 'APP-10293',
    creditScore: 768,
    monthlyIncome: 9200,
    monthlyDebt: 2760,
    requestedAmount: 240000,
  },
  decision: 'Approved — premium rate',
  outcome: 'approved',
  trace: {
    moduleName: 'credit.approval',
    functionName: 'decide',
    executionTimeMs: 0.42,
    finalResult: 'Approved — premium rate',
    steps: [
      {
        sequence: 1,
        expression: 'Let dtiRatio be monthlyDebt ÷ monthlyIncome',
        result: '2760 ÷ 9200 = 0.30',
        matched: true,
      },
      {
        sequence: 2,
        expression: 'creditScore at least 740 AND dtiRatio at most 0.35',
        result: '768 ≥ 740  ✓   AND   0.30 ≤ 0.35  ✓  →  true',
        matched: true,
        children: [
          { sequence: 3, expression: 'Return "Approved — premium rate"', result: 'Approved — premium rate', matched: true },
        ],
      },
    ],
  },
};

/** 场景 B：中分中等负债 → 转人工审核（边界案例，最常被监管问）。 */
const SCENARIO_REFER: DemoScenario = {
  key: 'refer',
  applicant: {
    id: 'APP-10487',
    creditScore: 642,
    monthlyIncome: 5400,
    monthlyDebt: 2380,
    requestedAmount: 180000,
  },
  decision: 'Refer to manual underwriting',
  outcome: 'refer',
  trace: {
    moduleName: 'credit.approval',
    functionName: 'decide',
    executionTimeMs: 0.39,
    finalResult: 'Refer to manual underwriting',
    steps: [
      {
        sequence: 1,
        expression: 'Let dtiRatio be monthlyDebt ÷ monthlyIncome',
        result: '2380 ÷ 5400 = 0.44',
        matched: true,
      },
      {
        sequence: 2,
        expression: 'creditScore at least 740 AND dtiRatio at most 0.35',
        result: '642 ≥ 740  ✗  →  false',
        matched: false,
      },
      {
        sequence: 3,
        expression: 'creditScore at least 660 AND dtiRatio at most 0.43',
        result: '642 ≥ 660  ✗  →  false',
        matched: false,
      },
      {
        sequence: 4,
        expression: 'creditScore at least 600',
        result: '642 ≥ 600  ✓  →  true',
        matched: true,
        children: [
          { sequence: 5, expression: 'Return "Refer to manual underwriting"', result: 'Refer to manual underwriting', matched: true },
        ],
      },
    ],
  },
};

/** 场景 C：低分 → 拒绝（拒贷决策必须可解释，是法律义务）。 */
const SCENARIO_DECLINED: DemoScenario = {
  key: 'declined',
  applicant: {
    id: 'APP-10561',
    creditScore: 561,
    monthlyIncome: 4100,
    monthlyDebt: 1640,
    requestedAmount: 150000,
  },
  decision: 'Declined — credit score below threshold',
  outcome: 'declined',
  trace: {
    moduleName: 'credit.approval',
    functionName: 'decide',
    executionTimeMs: 0.37,
    finalResult: 'Declined — credit score below threshold',
    steps: [
      {
        sequence: 1,
        expression: 'Let dtiRatio be monthlyDebt ÷ monthlyIncome',
        result: '1640 ÷ 4100 = 0.40',
        matched: true,
      },
      {
        sequence: 2,
        expression: 'creditScore at least 740 AND dtiRatio at most 0.35',
        result: '561 ≥ 740  ✗  →  false',
        matched: false,
      },
      {
        sequence: 3,
        expression: 'creditScore at least 660 AND dtiRatio at most 0.43',
        result: '561 ≥ 660  ✗  →  false',
        matched: false,
      },
      {
        sequence: 4,
        expression: 'creditScore at least 600',
        result: '561 ≥ 600  ✗  →  false',
        matched: false,
        children: [
          { sequence: 5, expression: 'Return "Declined — credit score below threshold"', result: 'Declined — credit score below threshold', matched: true },
        ],
      },
    ],
  },
};

export const DEMO_SCENARIOS: DemoScenario[] = [
  SCENARIO_APPROVED,
  SCENARIO_REFER,
  SCENARIO_DECLINED,
];

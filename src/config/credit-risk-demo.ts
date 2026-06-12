// 信贷风控 demo 数据：一条真实的贷款准入规则 + 三个样例申请人各自的决策回放 trace，
// 全部按语言本地化（en/zh/de）。
//
// 关键约束：三语规则必须**真能在生产引擎编译/执行**，不只是翻译文本。规则源用各语言
// 权威 lexicon 关键词书写，并由 `src/__tests__/credit-risk-demo.compile.test.ts` 用
// 生产同款 `@aster-cloud/aster-lang-ts/browser` 引擎逐语言编译校验——任一不编译即 CI 失败。
//
// trace（回放）是展示用，与规则的最终结果一致；表达式按语言本地化以贴合所示规则。

import type { DecisionTrace } from '@/components/policy/decision-trace-panel';

export type DemoLocale = 'en' | 'zh' | 'de';

/** 把 next-intl 的 locale（可能是 en-US 等）归一到 demo 三语。 */
export function toDemoLocale(locale: string): DemoLocale {
  const l = locale.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('de')) return 'de';
  return 'en';
}

/**
 * demo 用的信贷准入规则源码，按语言本地化。
 * 真实信贷逻辑：信用分 + 负债收入比(DTI) + 三段式决策。
 * 三语均已用生产引擎编译校验（见同名 compile 测试）。
 */
export const CREDIT_RISK_RULE_BY_LOCALE: Record<DemoLocale, string> = {
  en: `Module credit.approval.

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
`,
  zh: `模块 credit.approval。

定义 申请人 包含
  id 作为 文本，
  creditScore 作为 整数，
  monthlyIncome 作为 小数，
  monthlyDebt 作为 小数，
  requestedAmount 作为 小数。

规则 decide 给定 applicant 作为 申请人 产出 文本：
  令 dtiRatio 定义为 applicant.monthlyDebt 除以 applicant.monthlyIncome。
  如果 applicant.creditScore 至少 740 并且 dtiRatio 至多 0.35：
    返回 "批准 — 优惠利率"。
  否则：
    如果 applicant.creditScore 至少 660 并且 dtiRatio 至多 0.43：
      返回 "批准 — 标准利率"。
    否则：
      如果 applicant.creditScore 至少 600：
        返回 "转人工审核"。
      否则：
        返回 "拒绝 — 信用分低于门槛"。
`,
  de: `Modul credit.approval.

Definiere Antragsteller hat
  id als Text,
  creditScore als Ganzzahl,
  monthlyIncome als Dezimal,
  monthlyDebt als Dezimal,
  requestedAmount als Dezimal.

Regel decide gegeben applicant als Antragsteller liefert Text:
  sei dtiRatio gleich applicant.monthlyDebt geteilt durch applicant.monthlyIncome.
  wenn applicant.creditScore mindestens 740 und dtiRatio hoechstens 0.35:
    gib zurueck "Genehmigt — Vorzugszins".
  sonst:
    wenn applicant.creditScore mindestens 660 und dtiRatio hoechstens 0.43:
      gib zurueck "Genehmigt — Standardzins".
    sonst:
      wenn applicant.creditScore mindestens 600:
        gib zurueck "Zur Einzelfallprüfung".
      sonst:
        gib zurueck "Abgelehnt — Bonität unter Schwellenwert".
`,
};

/** demo 申请人输入字段（展示用）。 */
export interface DemoApplicant {
  id: string;
  creditScore: number;
  monthlyIncome: number;
  monthlyDebt: number;
  requestedAmount: number;
}

/**
 * 不利决策理由（adverse-action reason）——拒贷/转人工的法律披露物。
 *
 * 从回放 trace 里**那个让决策落定的决定性步骤**推导，不是另写一套：
 * UI 用 i18n + 这些数值组成人话理由（"因信用分 561 低于 600 门槛"），
 * 与下方 trace 的对应步骤一一对应、互为佐证。批准场景为 null。
 */
export interface AdverseReason {
  /** i18n key 后缀：reasons.<reasonKey> —— 决定哪条理由模板 */
  reasonKey: 'creditScore' | 'tierMiss';
  /** 实际值（如信用分 561） */
  actual: number;
  /** 门槛值（如 600） */
  threshold: number;
}

/** 一个 demo 场景：申请人 + 决策结果 + 可回放的 DecisionTrace。 */
export interface DemoScenario {
  /** i18n key 后缀（scenarios.<key>.label） */
  key: string;
  applicant: DemoApplicant;
  /** 最终决策文本（与规则 Return 一致，已本地化）。 */
  decision: string;
  /** 决策语气：approved / refer / declined，用于 UI 着色。 */
  outcome: 'approved' | 'refer' | 'declined';
  /** 不利决策理由（拒贷/转人工时非空；批准为 null）。 */
  adverseReason: AdverseReason | null;
  /** 该笔决策的逐步回放（喂给 DecisionTracePanel）。 */
  trace: DecisionTrace;
}

// ── 申请人（三语共用数值，仅决策文本/表达式本地化）──
const APPLICANTS = {
  approved: { id: 'APP-10293', creditScore: 768, monthlyIncome: 9200, monthlyDebt: 2760, requestedAmount: 240000 },
  refer: { id: 'APP-10487', creditScore: 642, monthlyIncome: 5400, monthlyDebt: 2380, requestedAmount: 180000 },
  declined: { id: 'APP-10561', creditScore: 561, monthlyIncome: 4100, monthlyDebt: 1640, requestedAmount: 150000 },
} as const;

// 各语言的决策文本（与规则 Return 字面量逐字一致）。
const DECISIONS: Record<DemoLocale, Record<'approved' | 'refer' | 'declined', string>> = {
  en: {
    approved: 'Approved — premium rate',
    refer: 'Refer to manual underwriting',
    declined: 'Declined — credit score below threshold',
  },
  zh: {
    approved: '批准 — 优惠利率',
    refer: '转人工审核',
    declined: '拒绝 — 信用分低于门槛',
  },
  de: {
    approved: 'Genehmigt — Vorzugszins',
    refer: 'Zur Einzelfallprüfung',
    declined: 'Abgelehnt — Bonität unter Schwellenwert',
  },
};

// 各语言 trace 中表达式的本地化片段（贴合所示规则的关键词）。
const TR: Record<DemoLocale, {
  dti: string;
  premiumCond: (s: number, ok: boolean, dti: string, dtiOk: boolean) => string;
  standardCond: (s: number, ok: boolean) => string;
  minScoreCond: (s: number, ok: boolean) => string;
  ret: (text: string) => string;
}> = {
  en: {
    dti: 'Let dtiRatio be monthlyDebt ÷ monthlyIncome',
    premiumCond: (s, ok, dti, dtiOk) =>
      ok ? `${s} ≥ 740 ✓ AND ${dti} ≤ 0.35 ${dtiOk ? '✓' : '✗'} → ${ok ? 'true' : 'false'}` : `${s} ≥ 740 ✗ → false`,
    standardCond: (s, ok) => (ok ? `${s} ≥ 660 ✓ → ...` : `${s} ≥ 660 ✗ → false`),
    minScoreCond: (s, ok) => `${s} ≥ 600 ${ok ? '✓ → true' : '✗ → false'}`,
    ret: (t) => `Return "${t}"`,
  },
  zh: {
    dti: '令 dtiRatio = 月负债 ÷ 月收入',
    premiumCond: (s, ok, dti, dtiOk) =>
      ok ? `${s} ≥ 740 ✓ 并且 ${dti} ≤ 0.35 ${dtiOk ? '✓' : '✗'} → 真` : `${s} ≥ 740 ✗ → 假`,
    standardCond: (s, ok) => (ok ? `${s} ≥ 660 ✓ → ...` : `${s} ≥ 660 ✗ → 假`),
    minScoreCond: (s, ok) => `${s} ≥ 600 ${ok ? '✓ → 真' : '✗ → 假'}`,
    ret: (t) => `返回 "${t}"`,
  },
  de: {
    dti: 'sei dtiRatio = Schulden ÷ Einkommen',
    premiumCond: (s, ok, dti, dtiOk) =>
      ok ? `${s} ≥ 740 ✓ und ${dti} ≤ 0.35 ${dtiOk ? '✓' : '✗'} → wahr` : `${s} ≥ 740 ✗ → falsch`,
    standardCond: (s, ok) => (ok ? `${s} ≥ 660 ✓ → ...` : `${s} ≥ 660 ✗ → falsch`),
    minScoreCond: (s, ok) => `${s} ≥ 600 ${ok ? '✓ → wahr' : '✗ → falsch'}`,
    ret: (t) => `gib zurück "${t}"`,
  },
};

function buildScenarios(loc: DemoLocale): DemoScenario[] {
  const d = DECISIONS[loc];
  const tr = TR[loc];

  // 场景 A：高分低负债 → 批准优惠利率
  const a = APPLICANTS.approved;
  const approved: DemoScenario = {
    key: 'approved',
    applicant: a,
    decision: d.approved,
    outcome: 'approved',
    adverseReason: null, // 批准——无不利决策理由
    trace: {
      moduleName: 'credit.approval',
      functionName: 'decide',
      executionTimeMs: 0.42,
      finalResult: d.approved,
      steps: [
        { sequence: 1, expression: tr.dti, result: '2760 ÷ 9200 = 0.30', matched: true },
        {
          sequence: 2,
          expression: tr.premiumCond(768, true, '0.30', true),
          result: '',
          matched: true,
          children: [{ sequence: 3, expression: tr.ret(d.approved), result: d.approved, matched: true }],
        },
      ],
    },
  };

  // 场景 B：中分中等负债 → 转人工
  const b = APPLICANTS.refer;
  const refer: DemoScenario = {
    key: 'refer',
    applicant: b,
    decision: d.refer,
    outcome: 'refer',
    // 信用分 642 ≥ 600（够转人工）但未满足前两档（740/660+DTI）→ 转人工的理由是"未达自动批准档"
    adverseReason: { reasonKey: 'tierMiss', actual: 642, threshold: 660 },
    trace: {
      moduleName: 'credit.approval',
      functionName: 'decide',
      executionTimeMs: 0.39,
      finalResult: d.refer,
      steps: [
        { sequence: 1, expression: tr.dti, result: '2380 ÷ 5400 = 0.44', matched: true },
        { sequence: 2, expression: tr.premiumCond(642, false, '0.44', false), result: '', matched: false },
        { sequence: 3, expression: tr.standardCond(642, false), result: '', matched: false },
        {
          sequence: 4,
          expression: tr.minScoreCond(642, true),
          result: '',
          matched: true,
          children: [{ sequence: 5, expression: tr.ret(d.refer), result: d.refer, matched: true }],
        },
      ],
    },
  };

  // 场景 C：低分 → 拒绝
  const c = APPLICANTS.declined;
  const declined: DemoScenario = {
    key: 'declined',
    applicant: c,
    decision: d.declined,
    outcome: 'declined',
    // 决定性步骤：信用分 561 < 600 门槛 → 拒贷的法律披露理由
    adverseReason: { reasonKey: 'creditScore', actual: 561, threshold: 600 },
    trace: {
      moduleName: 'credit.approval',
      functionName: 'decide',
      executionTimeMs: 0.37,
      finalResult: d.declined,
      steps: [
        { sequence: 1, expression: tr.dti, result: '1640 ÷ 4100 = 0.40', matched: true },
        { sequence: 2, expression: tr.premiumCond(561, false, '0.40', false), result: '', matched: false },
        { sequence: 3, expression: tr.standardCond(561, false), result: '', matched: false },
        {
          sequence: 4,
          expression: tr.minScoreCond(561, false),
          result: '',
          matched: false,
          children: [{ sequence: 5, expression: tr.ret(d.declined), result: d.declined, matched: true }],
        },
      ],
    },
  };

  return [approved, refer, declined];
}

const SCENARIO_CACHE: Partial<Record<DemoLocale, DemoScenario[]>> = {};

/** 按语言取 demo 场景（含本地化决策文本 + 回放 trace）。 */
export function getDemoScenarios(locale: string): DemoScenario[] {
  const loc = toDemoLocale(locale);
  return (SCENARIO_CACHE[loc] ??= buildScenarios(loc));
}

/** 按语言取 demo 规则源码。 */
export function getCreditRiskRule(locale: string): string {
  return CREDIT_RISK_RULE_BY_LOCALE[toDemoLocale(locale)];
}

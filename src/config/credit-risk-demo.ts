// 信贷风控 demo 数据 + 逻辑，全部按语言本地化（en/zh/de），含标识符本地化。
//
// 关键约束（已用生产引擎实证）：
//  1. 三语规则必须真能在 `@aster-cloud/aster-lang-ts/browser` 编译/执行——任一不编译即 CI 失败
//     （见 `src/__tests__/credit-risk-demo.compile.test.ts`）。
//  2. **标识符也本地化**：中文规则用中文模块/类型/规则/参数/字段名，德文用德文。
//     ⚠️ 德文坑：canonicalizer 会把 **ASCII 输入** 里的 ue/ae/oe 转成 ü/ä/ö
//     （`bonitaet`→`bonität`），故标识符避开 ue/ae/oe（否则 eval context 的 key 对不上）。
//     实证：**真正的 umlaut 字符（ü/ä/ö）原样透传**——所以决策字面量与德文关键词
//     一律直接写正字 umlaut（`Bonität`/`höchstens`/`gib zurück`），显示与执行完全一致。
//  3. demo 可改阈值/申请人重跑：用真实引擎 evaluate 得「决策」，回放 trace 由同一套阈值逻辑
//     在客户端重建（决策来自引擎=真，trace 镜像同一逻辑），并断言两者一致。

import type { DecisionTrace } from '@/components/policy/decision-trace-panel';

export type DemoLocale = 'en' | 'zh' | 'de';

export function toDemoLocale(locale: string): DemoLocale {
  const l = locale.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('de')) return 'de';
  return 'en';
}

// ── 每种语言的「标识符」（模块/类型/规则/参数/字段名），与关键词区分。──
// 标识符在 CNL 里是普通名字，引擎按字面匹配；de 一律避开 ue/ae/oe。
interface Identifiers {
  module: string;
  typeName: string;
  ruleName: string;
  param: string;
  fScore: string;
  fIncome: string;
  fDebt: string;
  fAmount: string;
  vDti: string;
}

const IDS: Record<DemoLocale, Identifiers> = {
  en: { module: 'credit.approval', typeName: 'Applicant', ruleName: 'decide', param: 'applicant',
    fScore: 'creditScore', fIncome: 'monthlyIncome', fDebt: 'monthlyDebt', fAmount: 'requestedAmount', vDti: 'dtiRatio' },
  zh: { module: '信贷.准入', typeName: '申请人', ruleName: '评估', param: '申请人',
    fScore: '信用分', fIncome: '月收入', fDebt: '月负债', fAmount: '申请额度', vDti: '负债比' },
  // de：标识符避开 ue/ae/oe（canonicalizer 会转 umlaut，毁掉 eval key 匹配）。
  de: { module: 'kredit.zulassung', typeName: 'Antragsteller', ruleName: 'entscheiden', param: 'antrag',
    fScore: 'score', fIncome: 'einkommen', fDebt: 'schulden', fAmount: 'betrag', vDti: 'quote' },
};

/** demo 可调阈值。 */
export interface Thresholds {
  premiumScore: number;
  premiumDti: number;
  standardScore: number;
  standardDti: number;
  minScore: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  premiumScore: 740, premiumDti: 0.35, standardScore: 660, standardDti: 0.43, minScore: 600,
};

/** 各语言决策文本（与规则 Return 字面量逐字一致；de 避开 ue）。 */
export const DECISIONS: Record<DemoLocale, Record<'premium' | 'standard' | 'refer' | 'declined', string>> = {
  en: {
    premium: 'Approved — premium rate',
    standard: 'Approved — standard rate',
    refer: 'Refer to manual underwriting',
    declined: 'Declined — credit score below threshold',
  },
  zh: {
    premium: '批准 — 优惠利率',
    standard: '批准 — 标准利率',
    refer: '转人工审核',
    declined: '拒绝 — 信用分低于门槛',
  },
  // 直接写正字 umlaut——引擎原样透传，显示与执行一致。
  de: {
    premium: 'Genehmigt — Vorzugszins',
    standard: 'Genehmigt — Standardzins',
    refer: 'Zur Einzelfallprüfung',
    declined: 'Abgelehnt — Bonität unter Schwellenwert',
  },
};

/** 生成 demo 规则源码（本地化标识符 + 给定阈值）。三语均经生产引擎编译/执行校验。 */
export function buildRuleSource(loc: DemoLocale, th: Thresholds): string {
  const id = IDS[loc];
  const dec = DECISIONS[loc];
  if (loc === 'zh') {
    return `模块 ${id.module}。

定义 ${id.typeName} 包含
  ${id.fScore} 作为 整数，
  ${id.fIncome} 作为 小数，
  ${id.fDebt} 作为 小数，
  ${id.fAmount} 作为 小数。

规则 ${id.ruleName} 给定 ${id.param} 作为 ${id.typeName} 产出 文本：
  令 ${id.vDti} 定义为 ${id.param}.${id.fDebt} 除以 ${id.param}.${id.fIncome}。
  如果 ${id.param}.${id.fScore} 至少 ${th.premiumScore} 并且 ${id.vDti} 至多 ${th.premiumDti}：
    返回 "${dec.premium}"。
  否则：
    如果 ${id.param}.${id.fScore} 至少 ${th.standardScore} 并且 ${id.vDti} 至多 ${th.standardDti}：
      返回 "${dec.standard}"。
    否则：
      如果 ${id.param}.${id.fScore} 至少 ${th.minScore}：
        返回 "${dec.refer}"。
      否则：
        返回 "${dec.declined}"。
`;
  }
  if (loc === 'de') {
    return `Modul ${id.module}.

Definiere ${id.typeName} hat
  ${id.fScore} als Ganzzahl,
  ${id.fIncome} als Dezimal,
  ${id.fDebt} als Dezimal,
  ${id.fAmount} als Dezimal.

Regel ${id.ruleName} gegeben ${id.param} als ${id.typeName} liefert Text:
  sei ${id.vDti} gleich ${id.param}.${id.fDebt} geteilt durch ${id.param}.${id.fIncome}.
  wenn ${id.param}.${id.fScore} mindestens ${th.premiumScore} und ${id.vDti} höchstens ${th.premiumDti}:
    gib zurück "${dec.premium}".
  sonst:
    wenn ${id.param}.${id.fScore} mindestens ${th.standardScore} und ${id.vDti} höchstens ${th.standardDti}:
      gib zurück "${dec.standard}".
    sonst:
      wenn ${id.param}.${id.fScore} mindestens ${th.minScore}:
        gib zurück "${dec.refer}".
      sonst:
        gib zurück "${dec.declined}".
`;
  }
  return `Module ${id.module}.

Define ${id.typeName} has
  ${id.fScore} as Int,
  ${id.fIncome} as Float,
  ${id.fDebt} as Float,
  ${id.fAmount} as Float.

Rule ${id.ruleName} given ${id.param} as ${id.typeName}, produce Text:
  Let ${id.vDti} be ${id.param}.${id.fDebt} divided by ${id.param}.${id.fIncome}.
  If ${id.param}.${id.fScore} at least ${th.premiumScore} and ${id.vDti} at most ${th.premiumDti}:
    Return "${dec.premium}".
  Otherwise:
    If ${id.param}.${id.fScore} at least ${th.standardScore} and ${id.vDti} at most ${th.standardDti}:
      Return "${dec.standard}".
    Otherwise:
      If ${id.param}.${id.fScore} at least ${th.minScore}:
        Return "${dec.refer}".
      Otherwise:
        Return "${dec.declined}".
`;
}

/** 申请人输入。 */
export interface DemoApplicant {
  id: string;
  creditScore: number;
  monthlyIncome: number;
  monthlyDebt: number;
  requestedAmount: number;
}

export const DEMO_APPLICANTS: Record<'approved' | 'refer' | 'declined', DemoApplicant> = {
  approved: { id: 'APP-10293', creditScore: 768, monthlyIncome: 9200, monthlyDebt: 2760, requestedAmount: 240000 },
  refer: { id: 'APP-10487', creditScore: 642, monthlyIncome: 5400, monthlyDebt: 2380, requestedAmount: 180000 },
  declined: { id: 'APP-10561', creditScore: 561, monthlyIncome: 4100, monthlyDebt: 1640, requestedAmount: 150000 },
};

export type Outcome = 'approved' | 'refer' | 'declined';

export interface AdverseReason {
  reasonKey: 'creditScore' | 'tierMiss';
  actual: number;
  threshold: number;
}

export interface DemoResult {
  decision: string;
  outcome: Outcome;
  adverseReason: AdverseReason | null;
  trace: DecisionTrace;
}

// trace 表达式本地化片段。
const TR: Record<DemoLocale, {
  dti: string;
  scoreAndDti: (s: number, sOk: boolean, dti: string, dtiOk: boolean, both: boolean) => string;
  minScore: (s: number, ok: boolean, thr: number) => string;
  ret: (t: string) => string;
  truthy: string; falsy: string;
}> = {
  en: {
    dti: 'Let dtiRatio be monthlyDebt ÷ monthlyIncome',
    scoreAndDti: (s, sOk, dti, dtiOk, both) =>
      `${s} score ${sOk ? '✓' : '✗'} AND ${dti} DTI ${dtiOk ? '✓' : '✗'} → ${both ? 'true' : 'false'}`,
    minScore: (s, ok, thr) => `${s} ≥ ${thr} ${ok ? '✓ → true' : '✗ → false'}`,
    ret: (t) => `Return "${t}"`,
    truthy: 'true', falsy: 'false',
  },
  zh: {
    dti: '令 负债比 = 月负债 ÷ 月收入',
    scoreAndDti: (s, sOk, dti, dtiOk, both) =>
      `信用分 ${s} ${sOk ? '✓' : '✗'} 并且 负债比 ${dti} ${dtiOk ? '✓' : '✗'} → ${both ? '真' : '假'}`,
    minScore: (s, ok, thr) => `信用分 ${s} ≥ ${thr} ${ok ? '✓ → 真' : '✗ → 假'}`,
    ret: (t) => `返回 "${t}"`,
    truthy: '真', falsy: '假',
  },
  de: {
    dti: 'sei quote = schulden ÷ einkommen',
    scoreAndDti: (s, sOk, dti, dtiOk, both) =>
      `Score ${s} ${sOk ? '✓' : '✗'} und Quote ${dti} ${dtiOk ? '✓' : '✗'} → ${both ? 'wahr' : 'falsch'}`,
    minScore: (s, ok, thr) => `Score ${s} ≥ ${thr} ${ok ? '✓ → wahr' : '✗ → falsch'}`,
    ret: (t) => `gib zurück "${t}"`,
    truthy: 'wahr', falsy: 'falsch',
  },
};

/**
 * 纯函数：按规则逻辑算出决策 + 回放 trace（镜像规则的三段式条件）。
 * 用于 ①生成回放 trace ②作为引擎执行结果的一致性参照。决策本身以引擎为准。
 */
export function computeDecision(loc: DemoLocale, app: DemoApplicant, th: Thresholds): DemoResult {
  const dec = DECISIONS[loc];
  const tr = TR[loc];
  const dti = app.monthlyDebt / app.monthlyIncome;
  const dtiStr = dti.toFixed(2);

  const premiumScoreOk = app.creditScore >= th.premiumScore;
  const premiumDtiOk = dti <= th.premiumDti;
  const standardScoreOk = app.creditScore >= th.standardScore;
  const standardDtiOk = dti <= th.standardDti;
  const minOk = app.creditScore >= th.minScore;

  const steps: DecisionTrace['steps'] = [
    { sequence: 1, expression: tr.dti, result: `${app.monthlyDebt} ÷ ${app.monthlyIncome} = ${dtiStr}`, matched: true },
  ];

  let decision: string;
  let outcome: Outcome;
  let adverseReason: AdverseReason | null = null;

  if (premiumScoreOk && premiumDtiOk) {
    decision = dec.premium; outcome = 'approved';
    steps.push({ sequence: 2, expression: tr.scoreAndDti(app.creditScore, premiumScoreOk, dtiStr, premiumDtiOk, true), result: tr.truthy, matched: true, children: [{ sequence: 3, expression: tr.ret(decision), result: decision, matched: true }] });
  } else {
    steps.push({ sequence: 2, expression: tr.scoreAndDti(app.creditScore, premiumScoreOk, dtiStr, premiumDtiOk, false), result: tr.falsy, matched: false });
    if (standardScoreOk && standardDtiOk) {
      decision = dec.standard; outcome = 'approved';
      steps.push({ sequence: 3, expression: tr.scoreAndDti(app.creditScore, standardScoreOk, dtiStr, standardDtiOk, true), result: tr.truthy, matched: true, children: [{ sequence: 4, expression: tr.ret(decision), result: decision, matched: true }] });
    } else {
      steps.push({ sequence: 3, expression: tr.scoreAndDti(app.creditScore, standardScoreOk, dtiStr, standardDtiOk, false), result: tr.falsy, matched: false });
      if (minOk) {
        decision = dec.refer; outcome = 'refer';
        adverseReason = { reasonKey: 'tierMiss', actual: app.creditScore, threshold: th.standardScore };
        steps.push({ sequence: 4, expression: tr.minScore(app.creditScore, true, th.minScore), result: tr.truthy, matched: true, children: [{ sequence: 5, expression: tr.ret(decision), result: decision, matched: true }] });
      } else {
        decision = dec.declined; outcome = 'declined';
        adverseReason = { reasonKey: 'creditScore', actual: app.creditScore, threshold: th.minScore };
        steps.push({ sequence: 4, expression: tr.minScore(app.creditScore, false, th.minScore), result: tr.falsy, matched: false, children: [{ sequence: 5, expression: tr.ret(decision), result: decision, matched: true }] });
      }
    }
  }

  return {
    decision,
    outcome,
    adverseReason,
    trace: { moduleName: IDS[loc].module, functionName: IDS[loc].ruleName, executionTimeMs: 0.4, finalResult: decision, steps },
  };
}

/** eval context 的 key 用本地化字段名（引擎按字面匹配）。 */
export function toEvalContext(loc: DemoLocale, app: DemoApplicant): Record<string, unknown> {
  const id = IDS[loc];
  return {
    [id.param]: {
      id: app.id,
      [id.fScore]: app.creditScore,
      [id.fIncome]: app.monthlyIncome,
      [id.fDebt]: app.monthlyDebt,
      [id.fAmount]: app.requestedAmount,
    },
  };
}

/** 当前语言的规则函数名（供 evaluate 调用）。 */
export function getRuleName(loc: DemoLocale): string {
  return IDS[loc].ruleName;
}

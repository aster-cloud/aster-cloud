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
  vAfford: string;
}

const IDS: Record<DemoLocale, Identifiers> = {
  en: { module: 'credit.approval', typeName: 'Applicant', ruleName: 'decide', param: 'applicant',
    fScore: 'creditScore', fIncome: 'monthlyIncome', fDebt: 'monthlyDebt', fAmount: 'requestedAmount', vDti: 'dtiRatio', vAfford: 'affordabilityCap' },
  zh: { module: '信贷.准入', typeName: '申请人', ruleName: '评估', param: '申请人',
    fScore: '信用分', fIncome: '月收入', fDebt: '月负债', fAmount: '申请额度', vDti: '负债比', vAfford: '可负担上限' },
  // de：标识符避开 ue/ae/oe（canonicalizer 会转 umlaut，毁掉 eval key 匹配）。
  de: { module: 'kredit.zulassung', typeName: 'Antragsteller', ruleName: 'entscheiden', param: 'antrag',
    fScore: 'score', fIncome: 'einkommen', fDebt: 'schulden', fAmount: 'betrag', vDti: 'quote', vAfford: 'leistbar' },
};

/** demo 可调阈值。 */
export interface Thresholds {
  premiumScore: number;
  premiumDti: number;
  standardScore: number;
  standardDti: number;
  minScore: number;
  /**
   * 可负担额度上限 = 年收入（月收入 × 12）× maxLti（贷款收入比上限）。
   * 申请额度超过此上限 → 即便信用分/负债比达标也不自动批准，转人工复核
   * （超额贷款须人工评估）。这让「申请额度」字段真正参与决策。
   */
  maxLti: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  premiumScore: 740, premiumDti: 0.35, standardScore: 660, standardDti: 0.43, minScore: 600, maxLti: 5,
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
  令 ${id.vAfford} 定义为 ${id.param}.${id.fIncome} 乘以 12 乘以 ${th.maxLti}。
  如果 ${id.param}.${id.fScore} 至少 ${th.premiumScore} 并且 ${id.vDti} 至多 ${th.premiumDti} 并且 ${id.param}.${id.fAmount} 至多 ${id.vAfford}：
    返回 "${dec.premium}"。
  否则：
    如果 ${id.param}.${id.fScore} 至少 ${th.standardScore} 并且 ${id.vDti} 至多 ${th.standardDti} 并且 ${id.param}.${id.fAmount} 至多 ${id.vAfford}：
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
  sei ${id.vAfford} gleich ${id.param}.${id.fIncome} mal 12 mal ${th.maxLti}.
  wenn ${id.param}.${id.fScore} mindestens ${th.premiumScore} und ${id.vDti} höchstens ${th.premiumDti} und ${id.param}.${id.fAmount} höchstens ${id.vAfford}:
    gib zurück "${dec.premium}".
  sonst:
    wenn ${id.param}.${id.fScore} mindestens ${th.standardScore} und ${id.vDti} höchstens ${th.standardDti} und ${id.param}.${id.fAmount} höchstens ${id.vAfford}:
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
  Let ${id.vAfford} be ${id.param}.${id.fIncome} times 12 times ${th.maxLti}.
  If ${id.param}.${id.fScore} at least ${th.premiumScore} and ${id.vDti} at most ${th.premiumDti} and ${id.param}.${id.fAmount} at most ${id.vAfford}:
    Return "${dec.premium}".
  Otherwise:
    If ${id.param}.${id.fScore} at least ${th.standardScore} and ${id.vDti} at most ${th.standardDti} and ${id.param}.${id.fAmount} at most ${id.vAfford}:
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

/**
 * 边界翻转对照对（knife-edge pair）：除 creditScore 差 1 分外**完全相同**的两份申请。
 * 在默认阈值下（standardScore=660），660 满足标准档 → APPROVED；659 差 1 分 → 跌出标准档、
 * 仅过最低分 → REFER。同一条规则、同样的输入，1 分翻转决策——精确性 + 可解释性 + 可回放性
 * 的最强单例证据（trace 逐步展示"为什么这 1 分改变了结果"）。
 *
 * 决策已用 computeDecision 逻辑逐步核实（dti=0.40≤0.43、额度 200000≤cap 360000）：
 *  - pass(660): 信用分 660≥660 ✓ + 负债比 0.40≤0.43 ✓ + 额度 ✓ → APPROVED(standard)
 *  - fail(659): 信用分 659<660 ✗ → 跌出标准档；659≥minScore 600 → REFER
 */
export const BOUNDARY_PAIR: { pass: DemoApplicant; fail: DemoApplicant } = {
  pass: { id: 'APP-10660', creditScore: 660, monthlyIncome: 6000, monthlyDebt: 2400, requestedAmount: 200000 },
  fail: { id: 'APP-10659', creditScore: 659, monthlyIncome: 6000, monthlyDebt: 2400, requestedAmount: 200000 },
};

export type Outcome = 'approved' | 'refer' | 'declined';

export interface AdverseReason {
  reasonKey: 'creditScore' | 'tierMiss' | 'overCap';
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
  afford: string;
  // 档位条件：信用分 + 负债比 + 申请额度三项 AND（amtOk = 额度 ≤ 可负担上限）。
  tier: (s: number, sOk: boolean, dti: string, dtiOk: boolean, amt: number, amtOk: boolean, all: boolean) => string;
  minScore: (s: number, ok: boolean, thr: number) => string;
  ret: (t: string) => string;
  truthy: string; falsy: string;
}> = {
  en: {
    dti: 'Let dtiRatio be monthlyDebt ÷ monthlyIncome',
    afford: 'Let affordabilityCap be monthlyIncome × 12 × LTI',
    tier: (s, sOk, dti, dtiOk, amt, amtOk, all) =>
      `score ${s} ${sOk ? '✓' : '✗'} AND DTI ${dti} ${dtiOk ? '✓' : '✗'} AND amount ${amt} ≤ cap ${amtOk ? '✓' : '✗'} → ${all ? 'true' : 'false'}`,
    minScore: (s, ok, thr) => `${s} ≥ ${thr} ${ok ? '✓ → true' : '✗ → false'}`,
    ret: (t) => `Return "${t}"`,
    truthy: 'true', falsy: 'false',
  },
  zh: {
    dti: '令 负债比 = 月负债 ÷ 月收入',
    afford: '令 可负担上限 = 月收入 × 12 × 贷款收入比',
    tier: (s, sOk, dti, dtiOk, amt, amtOk, all) =>
      `信用分 ${s} ${sOk ? '✓' : '✗'} 并且 负债比 ${dti} ${dtiOk ? '✓' : '✗'} 并且 额度 ${amt} ≤ 上限 ${amtOk ? '✓' : '✗'} → ${all ? '真' : '假'}`,
    minScore: (s, ok, thr) => `信用分 ${s} ≥ ${thr} ${ok ? '✓ → 真' : '✗ → 假'}`,
    ret: (t) => `返回 "${t}"`,
    truthy: '真', falsy: '假',
  },
  de: {
    dti: 'sei quote = schulden ÷ einkommen',
    afford: 'sei leistbar = einkommen × 12 × LTI',
    tier: (s, sOk, dti, dtiOk, amt, amtOk, all) =>
      `Score ${s} ${sOk ? '✓' : '✗'} und Quote ${dti} ${dtiOk ? '✓' : '✗'} und Betrag ${amt} ≤ Limit ${amtOk ? '✓' : '✗'} → ${all ? 'wahr' : 'falsch'}`,
    minScore: (s, ok, thr) => `Score ${s} ≥ ${thr} ${ok ? '✓ → wahr' : '✗ → falsch'}`,
    ret: (t) => `gib zurück "${t}"`,
    truthy: 'wahr', falsy: 'falsch',
  },
};

/**
 * 纯函数：按规则逻辑算出决策 + 回放 trace（镜像规则的四段式条件）。
 * 用于 ①生成回放 trace ②作为引擎执行结果的一致性参照。决策本身以引擎为准。
 *
 * 「申请额度」通过可负担上限（月收入 × 12 × maxLti）参与决策：额度超上限时，
 * 即便信用分/负债比达标也无法自动批准 → 转人工复核（超额贷款需人工评估）。
 */
export function computeDecision(loc: DemoLocale, app: DemoApplicant, th: Thresholds): DemoResult {
  const dec = DECISIONS[loc];
  const tr = TR[loc];
  const dti = app.monthlyDebt / app.monthlyIncome;
  const dtiStr = dti.toFixed(2);
  const affordCap = app.monthlyIncome * 12 * th.maxLti;
  const amountOk = app.requestedAmount <= affordCap;

  const premiumScoreOk = app.creditScore >= th.premiumScore;
  const premiumDtiOk = dti <= th.premiumDti;
  const premiumOk = premiumScoreOk && premiumDtiOk && amountOk;
  const standardScoreOk = app.creditScore >= th.standardScore;
  const standardDtiOk = dti <= th.standardDti;
  const standardOk = standardScoreOk && standardDtiOk && amountOk;
  const minOk = app.creditScore >= th.minScore;

  const steps: DecisionTrace['steps'] = [
    { sequence: 1, expression: tr.dti, result: `${app.monthlyDebt} ÷ ${app.monthlyIncome} = ${dtiStr}`, matched: true },
    { sequence: 2, expression: tr.afford, result: `${app.monthlyIncome} × 12 × ${th.maxLti} = ${affordCap}`, matched: true },
  ];

  let decision: string;
  let outcome: Outcome;
  let adverseReason: AdverseReason | null = null;

  if (premiumOk) {
    decision = dec.premium; outcome = 'approved';
    steps.push({ sequence: 3, expression: tr.tier(app.creditScore, premiumScoreOk, dtiStr, premiumDtiOk, app.requestedAmount, amountOk, true), result: tr.truthy, matched: true, children: [{ sequence: 4, expression: tr.ret(decision), result: decision, matched: true }] });
  } else {
    steps.push({ sequence: 3, expression: tr.tier(app.creditScore, premiumScoreOk, dtiStr, premiumDtiOk, app.requestedAmount, amountOk, false), result: tr.falsy, matched: false });
    if (standardOk) {
      decision = dec.standard; outcome = 'approved';
      steps.push({ sequence: 4, expression: tr.tier(app.creditScore, standardScoreOk, dtiStr, standardDtiOk, app.requestedAmount, amountOk, true), result: tr.truthy, matched: true, children: [{ sequence: 5, expression: tr.ret(decision), result: decision, matched: true }] });
    } else {
      steps.push({ sequence: 4, expression: tr.tier(app.creditScore, standardScoreOk, dtiStr, standardDtiOk, app.requestedAmount, amountOk, false), result: tr.falsy, matched: false });
      if (minOk) {
        decision = dec.refer; outcome = 'refer';
        // 好分但超额 → 因额度转人工；否则因分数边界转人工。
        adverseReason = !amountOk && standardScoreOk && standardDtiOk
          ? { reasonKey: 'overCap', actual: app.requestedAmount, threshold: affordCap }
          : { reasonKey: 'tierMiss', actual: app.creditScore, threshold: th.standardScore };
        steps.push({ sequence: 5, expression: tr.minScore(app.creditScore, true, th.minScore), result: tr.truthy, matched: true, children: [{ sequence: 6, expression: tr.ret(decision), result: decision, matched: true }] });
      } else {
        decision = dec.declined; outcome = 'declined';
        adverseReason = { reasonKey: 'creditScore', actual: app.creditScore, threshold: th.minScore };
        steps.push({ sequence: 5, expression: tr.minScore(app.creditScore, false, th.minScore), result: tr.falsy, matched: false, children: [{ sequence: 6, expression: tr.ret(decision), result: decision, matched: true }] });
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

// ───────────────────────────────────────────────────────────────────────────
// 决策哈希（PoC 杀手卖点：可独立重演 + 不可篡改）。
//
// 把"规则源 + locale + 输入 + 决策 + 逐步 trace"规范化成确定性字节序列，取 SHA-256。
// 同一条规则、同一输入、同一决策 → 永远同一哈希；任何一处被篡改 → 哈希改变。合规人
// 可拿哈希独立重算核对："这次决策确实来自这条规则、这些输入、产出了这个结果"。
// ───────────────────────────────────────────────────────────────────────────

/**
 * 稳定 JSON 序列化：对象键按字典序排序，保证同一逻辑值产出同一字节序列。
 * 数组顺序保留（trace.steps 有序，顺序是事实的一部分）。
 *
 * 显式拒绝非标准 JSON 值（undefined / function / symbol / NaN / Infinity）——它们经
 * JSON.stringify 会产出 `undefined`(数组里被 join 成空) 或 `null`，造成碰撞/不稳定，
 * 污染哈希的确定性。决策记录本就只含 string/number/boolean/null/object/array，遇到
 * 非法值是构造 bug，宁可抛错暴露也不静默产生不可靠哈希。
 */
function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const tpe = typeof value;
  if (tpe === 'string' || tpe === 'boolean') return JSON.stringify(value);
  if (tpe === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error(`stableStringify: non-finite number is not hashable: ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (tpe === 'undefined' || tpe === 'function' || tpe === 'symbol' || tpe === 'bigint') {
    throw new Error(`stableStringify: unsupported value type for hashing: ${tpe}`);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

/** 本次决策的规范化记录（哈希的原像）——构成"可回放的决策事实"。 */
export interface DecisionRecord {
  /** 执行的规则源码（含当前阈值，随规则文本变）。 */
  rule: string;
  /** 规则语言。 */
  locale: DemoLocale;
  /** 规则入口函数名。 */
  entry: string;
  /** 申请人输入（eval context，字段名本地化）。 */
  input: Record<string, unknown>;
  /** 引擎产出的决策。 */
  decision: string;
  /** 逐步执行轨迹（表达式 + 结果 + 是否命中）。 */
  trace: DecisionTrace;
}

/** 组装规范化决策记录。 */
export function buildDecisionRecord(
  loc: DemoLocale,
  rule: string,
  app: DemoApplicant,
  decision: string,
  trace: DecisionTrace,
): DecisionRecord {
  return {
    rule,
    locale: loc,
    entry: getRuleName(loc),
    input: toEvalContext(loc, app),
    decision,
    // **剥离 executionTimeMs**：执行耗时每次都不同，若入哈希则"独立重跑同规则同输入"
    // 会得到不同哈希——破坏"可确定性重算"的语义。哈希只锚定**逻辑事实**（规则/输入/
    // 决策/逐步推理），不锚定 volatile 的执行计时。计时仍在 UI 展示，只是不入哈希。
    trace: { ...trace, executionTimeMs: 0 },
  };
}

/**
 * 决策记录的 SHA-256 十六进制摘要。浏览器/Workers 用 `crypto.subtle`（同源）。
 * 确定性：同一 DecisionRecord 永远产出同一哈希——可被任何一方独立重算核对。
 */
export async function digestDecision(record: DecisionRecord): Promise<string> {
  const canonical = stableStringify(record);
  const bytes = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** cloud 短码 → 后端 lexicon 全码（evaluate-source 的 locale 参数）。 */
const DEMO_LOCALE_FULL_ID: Record<DemoLocale, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  de: 'de-DE',
};

/** 后端（Java/Truffle 引擎）执行结果。 */
export interface JvmEngineResult {
  /** 引擎产出的决策字符串（与 TS 浏览器引擎应逐字节相同）。 */
  decision: string | null;
  /** 是否成功拿到决策。 */
  ok: boolean;
  /** 失败时的简短原因（展示用，不抛）。 */
  error?: string;
}

/**
 * 调后端 `/api/v1/policies/evaluate-source`（经 cloud playground BFF，匿名 + HMAC 签名）
 * 用 **Java/Truffle 引擎**执行同一条规则同一申请人，取其决策。
 *
 * 用途：与浏览器内 TS 引擎的决策**并排对比**，现场证明"两个独立引擎逐字节相同"——
 * 这是双引擎确定性护城河最硬的可验证证据。
 *
 * fail-open：后端不可达 / 限流 / 解析失败都返回 `{ ok:false }`，UI 降级为"仅 TS 引擎"，
 * 绝不阻断 demo（marketing 页不能因后端抖动白屏）。
 */
export async function evaluateOnJvmEngine(
  loc: DemoLocale,
  source: string,
  app: DemoApplicant,
): Promise<JvmEngineResult> {
  try {
    const res = await fetch('/api/playground/evaluate-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        source,
        context: toEvalContext(loc, app),
        locale: DEMO_LOCALE_FULL_ID[loc],
        functionName: getRuleName(loc),
      }),
    });
    if (!res.ok) {
      return { decision: null, ok: false, error: `HTTP ${res.status}` };
    }
    // 后端 EvaluationResponse 形态：{ result, executionTimeMs, error, decisionTrace?, ... }。
    const data = (await res.json()) as { result?: unknown; error?: string };
    if (data.error) {
      return { decision: null, ok: false, error: data.error };
    }
    if (data.result === undefined || data.result === null) {
      return { decision: null, ok: false, error: 'empty_result' };
    }
    return { decision: String(data.result), ok: true };
  } catch (e) {
    return { decision: null, ok: false, error: e instanceof Error ? e.message : 'fetch_failed' };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 确定性解释模型（不依赖 LLM）。
//
// 事实部分（字段、值、中间指标、逐步判断、最终理由）由此处从 trace/规则/阈值
// 直接构造，保证数字 100% 正确——LLM 即便被要求引用也会吐空值，故事实绝不交给它。
// LLM 仅用于在事实之上生成一段人话叙述（可选）。
// ───────────────────────────────────────────────────────────────────────────

/** 一个字段在本次执行中的说明（名称/类型/实际值/用途）。 */
export interface ExplainedField {
  name: string;
  type: string;
  value: string;
  purpose: string;
}

/** 一个中间指标（如负债比、可负担上限）的计算说明。 */
export interface ExplainedMetric {
  name: string;
  formula: string;
  computation: string;
  result: string;
}

/** 一个判断档位的说明：条件 + 是否求值 + 结果。 */
export interface ExplainedTier {
  title: string;
  /** 该档位是否在本次执行中被求值（短路后的档位为 false）。 */
  evaluated: boolean;
  /** 求值时：条件表达式（含实际值）+ 真假。未求值时：短路说明。 */
  detail: string;
  matched: boolean | null; // null = 未求值
}

/** 完整的确定性解释模型（全部值已代入，已本地化）。 */
export interface CreditExplanation {
  moduleName: string;
  ruleName: string;
  decision: string;
  outcome: Outcome;
  fields: ExplainedField[];
  metrics: ExplainedMetric[];
  tiers: ExplainedTier[];
  /** 一句话原因（含实际值）。 */
  oneLineReason: string;
}

interface ExplainStrings {
  fieldTypes: { int: string; float: string };
  purposes: { score: string; income: string; debt: string; amount: string };
  metricNames: { dti: string; afford: string };
  metricFormulas: { dti: string; afford: string };
  tierTitles: { premium: string; standard: string; refer: string; declined: string };
  // 短路说明：「前面某档已返回，本档未执行」。
  shortCircuit: string;
  // 档位条件文本（含实际值）。amt 仅 premium/standard 用。
  scoreDtiAmt: (s: number, sT: number, dti: string, dtiT: number, amt: number, cap: number) => string;
  minScore: (s: number, thr: number) => string;
  // 一句话原因构造（按结果）。
  reasonPremium: (s: number, sT: number, dti: string, dtiT: number, amt: number, cap: number) => string;
  reasonStandard: (s: number, sT: number, dti: string, dtiT: number, amt: number, cap: number) => string;
  reasonReferScore: (s: number, sT: number, minT: number) => string;
  reasonReferAmount: (amt: number, cap: number) => string;
  reasonDeclined: (s: number, minT: number) => string;
  matchedYes: string;
  matchedNo: string;
}

const EXPLAIN: Record<DemoLocale, ExplainStrings> = {
  en: {
    fieldTypes: { int: 'Int', float: 'Float' },
    purposes: {
      score: 'Decides the premium / standard / manual-review tier',
      income: 'Computes the DTI ratio and the affordability cap',
      debt: 'Computes the DTI ratio',
      amount: 'Checked against the affordability cap',
    },
    metricNames: { dti: 'DTI ratio', afford: 'Affordability cap' },
    metricFormulas: { dti: 'monthlyDebt ÷ monthlyIncome', afford: 'monthlyIncome × 12 × max loan-to-income' },
    tierTitles: { premium: 'Approved — premium rate', standard: 'Approved — standard rate', refer: 'Refer to manual underwriting', declined: 'Declined' },
    shortCircuit: 'An earlier branch already returned a result, so this branch was not evaluated.',
    scoreDtiAmt: (s, sT, dti, dtiT, amt, cap) =>
      `score ${s} ≥ ${sT} AND DTI ${dti} ≤ ${dtiT} AND amount ${amt} ≤ cap ${cap}`,
    minScore: (s, thr) => `score ${s} ≥ ${thr}`,
    reasonPremium: (s, sT, dti, dtiT, amt, cap) =>
      `Credit score ${s} meets the ${sT} premium threshold, DTI ${dti} is within ${dtiT}, and the requested amount ${amt} is within the affordability cap ${cap}.`,
    reasonStandard: (s, sT, dti, dtiT, amt, cap) =>
      `Credit score ${s} meets the ${sT} standard threshold, DTI ${dti} is within ${dtiT}, and the requested amount ${amt} is within the affordability cap ${cap} — but it did not meet the premium tier.`,
    reasonReferScore: (s, sT, minT) =>
      `Credit score ${s} clears the ${minT} minimum but not the ${sT} threshold for automatic approval, so it goes to manual review.`,
    reasonReferAmount: (amt, cap) =>
      `The requested amount ${amt} exceeds the affordability cap ${cap}, so even with a qualifying score it goes to manual review for an oversized loan.`,
    reasonDeclined: (s, minT) =>
      `Credit score ${s} is below the ${minT} minimum required to lend, so the application is declined.`,
    matchedYes: 'true', matchedNo: 'false',
  },
  zh: {
    fieldTypes: { int: '整数', float: '小数' },
    purposes: {
      score: '决定优惠 / 标准 / 人工审核档位',
      income: '用于计算负债比和可负担上限',
      debt: '用于计算负债比',
      amount: '用于和可负担上限比较',
    },
    metricNames: { dti: '负债比', afford: '可负担上限' },
    metricFormulas: { dti: '月负债 ÷ 月收入', afford: '月收入 × 12 × 贷款收入比上限' },
    tierTitles: { premium: '批准 — 优惠利率', standard: '批准 — 标准利率', refer: '转人工审核', declined: '拒绝' },
    shortCircuit: '前面的档位已返回结果，本档位未被求值。',
    scoreDtiAmt: (s, sT, dti, dtiT, amt, cap) =>
      `信用分 ${s} ≥ ${sT} 且 负债比 ${dti} ≤ ${dtiT} 且 申请额度 ${amt} ≤ 可负担上限 ${cap}`,
    minScore: (s, thr) => `信用分 ${s} ≥ ${thr}`,
    reasonPremium: (s, sT, dti, dtiT, amt, cap) =>
      `信用分 ${s} 达到优惠门槛 ${sT}，负债比 ${dti} 不超过 ${dtiT}，且申请额度 ${amt} 不超过可负担上限 ${cap}。`,
    reasonStandard: (s, sT, dti, dtiT, amt, cap) =>
      `信用分 ${s} 达到标准门槛 ${sT}，负债比 ${dti} 不超过 ${dtiT}，且申请额度 ${amt} 不超过可负担上限 ${cap}——但未达到优惠档。`,
    reasonReferScore: (s, sT, minT) =>
      `信用分 ${s} 超过最低门槛 ${minT}，但未达自动批准门槛 ${sT}，因此转人工审核。`,
    reasonReferAmount: (amt, cap) =>
      `申请额度 ${amt} 超过可负担上限 ${cap}，即便信用分达标也因超额贷款转人工审核。`,
    reasonDeclined: (s, minT) =>
      `信用分 ${s} 低于放贷所需的最低门槛 ${minT}，因此拒绝。`,
    matchedYes: '真', matchedNo: '假',
  },
  de: {
    fieldTypes: { int: 'Ganzzahl', float: 'Dezimal' },
    purposes: {
      score: 'Bestimmt die Stufe (Vorzug / Standard / manuelle Prüfung)',
      income: 'Berechnet die DTI-Quote und das Leistbarkeitslimit',
      debt: 'Berechnet die DTI-Quote',
      amount: 'Wird mit dem Leistbarkeitslimit verglichen',
    },
    metricNames: { dti: 'DTI-Quote', afford: 'Leistbarkeitslimit' },
    metricFormulas: { dti: 'schulden ÷ einkommen', afford: 'einkommen × 12 × max. Kredit-Einkommen-Verhältnis' },
    tierTitles: { premium: 'Genehmigt — Vorzugszins', standard: 'Genehmigt — Standardzins', refer: 'Zur Einzelfallprüfung', declined: 'Abgelehnt' },
    shortCircuit: 'Ein früherer Zweig hat bereits ein Ergebnis geliefert, daher wurde dieser Zweig nicht ausgewertet.',
    scoreDtiAmt: (s, sT, dti, dtiT, amt, cap) =>
      `Score ${s} ≥ ${sT} und Quote ${dti} ≤ ${dtiT} und Betrag ${amt} ≤ Limit ${cap}`,
    minScore: (s, thr) => `Score ${s} ≥ ${thr}`,
    reasonPremium: (s, sT, dti, dtiT, amt, cap) =>
      `Score ${s} erreicht die Vorzugsschwelle ${sT}, die Quote ${dti} liegt innerhalb ${dtiT}, und der Betrag ${amt} liegt innerhalb des Limits ${cap}.`,
    reasonStandard: (s, sT, dti, dtiT, amt, cap) =>
      `Score ${s} erreicht die Standardschwelle ${sT}, die Quote ${dti} liegt innerhalb ${dtiT}, und der Betrag ${amt} liegt innerhalb des Limits ${cap} — die Vorzugsstufe wurde jedoch nicht erreicht.`,
    reasonReferScore: (s, sT, minT) =>
      `Score ${s} überschreitet das Minimum ${minT}, aber nicht die Schwelle ${sT} für eine automatische Genehmigung; daher manuelle Prüfung.`,
    reasonReferAmount: (amt, cap) =>
      `Der Betrag ${amt} überschreitet das Limit ${cap}; trotz ausreichendem Score erfolgt wegen des übergroßen Kredits eine manuelle Prüfung.`,
    reasonDeclined: (s, minT) =>
      `Score ${s} liegt unter dem für eine Kreditvergabe erforderlichen Minimum ${minT}; der Antrag wird abgelehnt.`,
    matchedYes: 'wahr', matchedNo: 'falsch',
  },
};

/**
 * 构造确定性解释模型：把规则、阈值、申请人值、决策全部代入，保证数字正确。
 * 这是 AI 解释的「事实基座」——前端直接渲染它，不经过 LLM。
 */
export function buildExplanation(loc: DemoLocale, app: DemoApplicant, th: Thresholds): CreditExplanation {
  const id = IDS[loc];
  const s = EXPLAIN[loc];
  const result = computeDecision(loc, app, th);
  const dti = app.monthlyDebt / app.monthlyIncome;
  const dtiStr = dti.toFixed(2);
  const affordCap = app.monthlyIncome * 12 * th.maxLti;

  const fields: ExplainedField[] = [
    { name: id.fScore, type: s.fieldTypes.int, value: String(app.creditScore), purpose: s.purposes.score },
    { name: id.fIncome, type: s.fieldTypes.float, value: String(app.monthlyIncome), purpose: s.purposes.income },
    { name: id.fDebt, type: s.fieldTypes.float, value: String(app.monthlyDebt), purpose: s.purposes.debt },
    { name: id.fAmount, type: s.fieldTypes.float, value: String(app.requestedAmount), purpose: s.purposes.amount },
  ];

  const metrics: ExplainedMetric[] = [
    { name: s.metricNames.dti, formula: s.metricFormulas.dti, computation: `${app.monthlyDebt} ÷ ${app.monthlyIncome}`, result: dtiStr },
    { name: s.metricNames.afford, formula: s.metricFormulas.afford, computation: `${app.monthlyIncome} × 12 × ${th.maxLti}`, result: String(affordCap) },
  ];

  // 各档位的求值情况：premium 永远求值；其余档位只有在前面都不满足时才求值。
  const premiumScoreOk = app.creditScore >= th.premiumScore;
  const premiumDtiOk = dti <= th.premiumDti;
  const amountOk = app.requestedAmount <= affordCap;
  const premiumOk = premiumScoreOk && premiumDtiOk && amountOk;
  const standardScoreOk = app.creditScore >= th.standardScore;
  const standardDtiOk = dti <= th.standardDti;
  const standardOk = standardScoreOk && standardDtiOk && amountOk;
  const minOk = app.creditScore >= th.minScore;

  const tiers: ExplainedTier[] = [];
  // premium：总被求值。
  tiers.push({
    title: s.tierTitles.premium, evaluated: true,
    detail: s.scoreDtiAmt(app.creditScore, th.premiumScore, dtiStr, th.premiumDti, app.requestedAmount, affordCap),
    matched: premiumOk,
  });
  // standard：仅 premium 不满足时求值。
  tiers.push(premiumOk
    ? { title: s.tierTitles.standard, evaluated: false, detail: s.shortCircuit, matched: null }
    : {
        title: s.tierTitles.standard, evaluated: true,
        detail: s.scoreDtiAmt(app.creditScore, th.standardScore, dtiStr, th.standardDti, app.requestedAmount, affordCap),
        matched: standardOk,
      });
  // refer：仅 premium、standard 都不满足时求值。
  tiers.push(premiumOk || standardOk
    ? { title: s.tierTitles.refer, evaluated: false, detail: s.shortCircuit, matched: null }
    : { title: s.tierTitles.refer, evaluated: true, detail: s.minScore(app.creditScore, th.minScore), matched: minOk });
  // declined：仅前面都不满足且分数不足时为最终分支。
  tiers.push(premiumOk || standardOk || minOk
    ? { title: s.tierTitles.declined, evaluated: false, detail: s.shortCircuit, matched: null }
    : { title: s.tierTitles.declined, evaluated: true, detail: s.minScore(app.creditScore, th.minScore), matched: false });

  // 一句话原因：按最终结果挑对应文案（含实际值）。
  let oneLineReason: string;
  if (premiumOk) {
    oneLineReason = s.reasonPremium(app.creditScore, th.premiumScore, dtiStr, th.premiumDti, app.requestedAmount, affordCap);
  } else if (standardOk) {
    oneLineReason = s.reasonStandard(app.creditScore, th.standardScore, dtiStr, th.standardDti, app.requestedAmount, affordCap);
  } else if (minOk) {
    // 好分但超额 → 额度原因；否则分数边界原因。
    oneLineReason = !amountOk && standardScoreOk && standardDtiOk
      ? s.reasonReferAmount(app.requestedAmount, affordCap)
      : s.reasonReferScore(app.creditScore, th.standardScore, th.minScore);
  } else {
    oneLineReason = s.reasonDeclined(app.creditScore, th.minScore);
  }

  return {
    moduleName: id.module,
    ruleName: id.ruleName,
    decision: result.decision,
    outcome: result.outcome,
    fields,
    metrics,
    tiers,
    oneLineReason,
  };
}

// 领域词汇 demo 数据 + 逻辑：展示「用你行业自己的术语写规则，引擎照样编译执行」。
//
// 与信贷 demo（讲「可回放」）错开——这个讲「领域贴合/可读性」：业务人员用本行业说法，
// 不用学工程术语。三个领域（医疗/保险/物流）可切换，证明任意领域词汇都能注入引擎。
//
// **三语本地化**：中文站用中文 CNL 关键词 + 中文行业术语 + 中文决策文本，德文站用德文。
// canonical（引擎规范名）跨语言一致；eval 输入键永远用 canonical（领域词只在表层）。
//
// 关键技术契约（已用生产引擎实证，见 vocab-demo.compile.test.ts）：
//  1. 规则用**行业术语**（localized）+ 对应语言 CNL 关键词书写；compile(src, { lexicon,
//     domain, tenantId }) 经 vocabularyRegistry.registerCustom（按 locale 注册）注入的领域
//     词汇，把行业术语翻译成 canonical IR。lexicon 与 vocab 的 locale 必须一致。
//  2. **eval 输入必须用 canonical 字段名**（如 systolic 而非 收缩压）——领域词只在表层。
//  3. registerCustom key = `${tenantId}:${domain}:${locale}`；compile 传同一组 domain+tenantId。
//  4. ⚠️ 规则 param 名**不得是 struct localized 名的大小写变体**（领域 canonicalizer 会误把
//     param 当术语翻译→编译静默落空）。param 用与 struct 无关的中性词。

import {
  vocabularyRegistry,
  EN_US, ZH_CN, DE_DE,
  type Lexicon,
  type DomainVocabulary,
} from '@/lib/aster-lexicon';
import {
  assembleDomainVocabularyFromLinks,
  type TermLikeRow,
} from '@/lib/domain-vocabulary-assemble';

export type DemoLocale = 'en' | 'zh' | 'de';

export function toDemoLocale(locale: string): DemoLocale {
  const l = locale.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('de')) return 'de';
  return 'en';
}

const LEXICONS: Record<DemoLocale, Lexicon> = { en: EN_US, zh: ZH_CN, de: DE_DE };
const LOCALE_TAGS: Record<DemoLocale, string> = { en: 'en-US', zh: 'zh-CN', de: 'de-DE' };

/** demo 用固定匿名租户（公开页无 session）。 */
export const VOCAB_DEMO_TENANT = 'vocab-demo-anon';

export type VocabDomainId = 'healthcare' | 'insurance' | 'logistics';

/** 一条领域术语在某语言下的行业说法（canonical=引擎规范名跨语言一致）。 */
export interface VocabTerm {
  kind: 'struct' | 'field';
  canonical: string;
  /** field 的父 struct canonical 名。 */
  parent?: string;
  /** 三语行业说法。 */
  localized: Record<DemoLocale, string>;
}

/** 一个案例输入（key = canonical 字段名，因为 IR 用规范名，跨语言共享）。 */
export type CaseInput = Record<string, number>;

/** 某语言下的规则呈现：CNL 源码 + 决策文本 + 函数/参数名。 */
export interface LocalizedRule {
  /** 规则源码（用该语言 CNL 关键词 + 行业术语书写）。 */
  source: string;
  /** 规则函数名（CNL 里书写的名字，evaluate 用）。 */
  ruleName: string;
  /** 规则参数名（eval context 顶层 key）。 */
  paramName: string;
}

export interface VocabDomain {
  id: VocabDomainId;
  terms: VocabTerm[];
  /** 三语规则。 */
  rules: Record<DemoLocale, LocalizedRule>;
  /** 案例：canonical-key 输入 + 每语言预期决策。 */
  cases: { id: string; labelKey: string; input: CaseInput; expect: Record<DemoLocale, string> }[];
}

// ── 医疗/临床分诊 ──
const HEALTHCARE: VocabDomain = {
  id: 'healthcare',
  terms: [
    { kind: 'struct', canonical: 'Patient', localized: { en: 'PatientCase', zh: '就诊病例', de: 'Fallakte' } },
    { kind: 'field', canonical: 'systolic', parent: 'Patient', localized: { en: 'sysBP', zh: '收缩压', de: 'sysDruck' } },
    { kind: 'field', canonical: 'heartRate', parent: 'Patient', localized: { en: 'pulseBpm', zh: '心率', de: 'pulsRate' } },
    { kind: 'field', canonical: 'age', parent: 'Patient', localized: { en: 'patientAge', zh: '患者年龄', de: 'patientAlter' } },
  ],
  rules: {
    en: {
      ruleName: 'triage', paramName: 'visit',
      source: `Module clinic.triage.

Define PatientCase has
  sysBP as Int,
  pulseBpm as Int,
  patientAge as Int.

Rule triage given visit as PatientCase, produce Text:
  If visit.sysBP at least 180:
    Return "Emergency — immediate review".
  Otherwise:
    If visit.sysBP at least 140:
      Return "Refer to specialist".
    Otherwise:
      If visit.pulseBpm at least 110:
        Return "Refer to specialist".
      Otherwise:
        Return "Routine follow-up".
`,
    },
    zh: {
      ruleName: '分诊', paramName: '本次',
      source: `模块 诊所.分诊。

定义 就诊病例 包含
  收缩压 作为 整数，
  心率 作为 整数，
  患者年龄 作为 整数。

规则 分诊 给定 本次 作为 就诊病例 产出 文本：
  如果 本次.收缩压 至少 180：
    返回 "急诊 — 立即处理"。
  否则：
    如果 本次.收缩压 至少 140：
      返回 "转专科"。
    否则：
      如果 本次.心率 至少 110：
        返回 "转专科"。
      否则：
        返回 "常规随访"。
`,
    },
    de: {
      ruleName: 'triage', paramName: 'fall',
      source: `Modul klinik.triage.

Definiere Fallakte hat
  sysDruck als Ganzzahl,
  pulsRate als Ganzzahl,
  patientAlter als Ganzzahl.

Regel triage gegeben fall als Fallakte liefert Text:
  wenn fall.sysDruck mindestens 180:
    gib zurück "Notfall — sofortige Prüfung".
  sonst:
    wenn fall.sysDruck mindestens 140:
      gib zurück "Zur Fachabteilung".
    sonst:
      wenn fall.pulsRate mindestens 110:
        gib zurück "Zur Fachabteilung".
      sonst:
        gib zurück "Routinekontrolle".
`,
    },
  },
  cases: [
    { id: 'PT-7781', labelKey: 'emergency', input: { systolic: 188, heartRate: 96, age: 67 },
      expect: { en: 'Emergency — immediate review', zh: '急诊 — 立即处理', de: 'Notfall — sofortige Prüfung' } },
    { id: 'PT-7782', labelKey: 'refer', input: { systolic: 152, heartRate: 88, age: 54 },
      expect: { en: 'Refer to specialist', zh: '转专科', de: 'Zur Fachabteilung' } },
    { id: 'PT-7783', labelKey: 'routine', input: { systolic: 124, heartRate: 72, age: 41 },
      expect: { en: 'Routine follow-up', zh: '常规随访', de: 'Routinekontrolle' } },
  ],
};

// ── 保险/理赔准入 ──
const INSURANCE: VocabDomain = {
  id: 'insurance',
  terms: [
    { kind: 'struct', canonical: 'Claim', localized: { en: 'ClaimFile', zh: '理赔案件', de: 'Schadenakte' } },
    { kind: 'field', canonical: 'claimAmount', parent: 'Claim', localized: { en: 'payoutAsk', zh: '索赔金额', de: 'forderung' } },
    { kind: 'field', canonical: 'deductible', parent: 'Claim', localized: { en: 'excess', zh: '免赔额', de: 'selbstbehalt' } },
    { kind: 'field', canonical: 'priorClaims', parent: 'Claim', localized: { en: 'historyCount', zh: '历史出险', de: 'vorschadenZahl' } },
  ],
  rules: {
    en: {
      ruleName: 'assess', paramName: 'filing',
      source: `Module claims.intake.

Define ClaimFile has
  payoutAsk as Int,
  excess as Int,
  historyCount as Int.

Rule assess given filing as ClaimFile, produce Text:
  If filing.payoutAsk at most filing.excess:
    Return "Declined — below deductible".
  Otherwise:
    If filing.payoutAsk at least 50000:
      Return "Refer to adjuster".
    Otherwise:
      If filing.historyCount at least 3:
        Return "Refer to adjuster".
      Otherwise:
        Return "Auto-approve".
`,
    },
    zh: {
      ruleName: '评估', paramName: '本案',
      source: `模块 理赔.准入。

定义 理赔案件 包含
  索赔金额 作为 整数，
  免赔额 作为 整数，
  历史出险 作为 整数。

规则 评估 给定 本案 作为 理赔案件 产出 文本：
  如果 本案.索赔金额 至多 本案.免赔额：
    返回 "拒赔 — 低于免赔额"。
  否则：
    如果 本案.索赔金额 至少 50000：
      返回 "转定损员"。
    否则：
      如果 本案.历史出险 至少 3：
        返回 "转定损员"。
      否则：
        返回 "自动核准"。
`,
    },
    de: {
      ruleName: 'bewerten', paramName: 'vorgang',
      source: `Modul schaden.annahme.

Definiere Schadenakte hat
  forderung als Ganzzahl,
  selbstbehalt als Ganzzahl,
  vorschadenZahl als Ganzzahl.

Regel bewerten gegeben vorgang als Schadenakte liefert Text:
  wenn vorgang.forderung höchstens vorgang.selbstbehalt:
    gib zurück "Abgelehnt — unter Selbstbehalt".
  sonst:
    wenn vorgang.forderung mindestens 50000:
      gib zurück "Zur Schadenregulierung".
    sonst:
      wenn vorgang.vorschadenZahl mindestens 3:
        gib zurück "Zur Schadenregulierung".
      sonst:
        gib zurück "Automatisch genehmigt".
`,
    },
  },
  cases: [
    { id: 'CLM-3301', labelKey: 'approve', input: { claimAmount: 4200, deductible: 500, priorClaims: 1 },
      expect: { en: 'Auto-approve', zh: '自动核准', de: 'Automatisch genehmigt' } },
    { id: 'CLM-3302', labelKey: 'refer', input: { claimAmount: 72000, deductible: 1000, priorClaims: 0 },
      expect: { en: 'Refer to adjuster', zh: '转定损员', de: 'Zur Schadenregulierung' } },
    { id: 'CLM-3303', labelKey: 'declined', input: { claimAmount: 300, deductible: 500, priorClaims: 2 },
      expect: { en: 'Declined — below deductible', zh: '拒赔 — 低于免赔额', de: 'Abgelehnt — unter Selbstbehalt' } },
  ],
};

// ── 物流/订单履约 ──
const LOGISTICS: VocabDomain = {
  id: 'logistics',
  terms: [
    { kind: 'struct', canonical: 'Shipment', localized: { en: 'Parcel', zh: '货件', de: 'Sendung' } },
    { kind: 'field', canonical: 'weightKg', parent: 'Shipment', localized: { en: 'grossKg', zh: '毛重', de: 'bruttoKg' } },
    { kind: 'field', canonical: 'distanceKm', parent: 'Shipment', localized: { en: 'legKm', zh: '运距', de: 'streckeKm' } },
    { kind: 'field', canonical: 'priority', parent: 'Shipment', localized: { en: 'slaTier', zh: '时效等级', de: 'slaStufe' } },
  ],
  rules: {
    en: {
      ruleName: 'route', paramName: 'item',
      source: `Module fulfilment.routing.

Define Parcel has
  grossKg as Int,
  legKm as Int,
  slaTier as Int.

Rule route given item as Parcel, produce Text:
  If item.slaTier at least 3:
    Return "Air express".
  Otherwise:
    If item.grossKg at least 30:
      Return "Line haul freight".
    Otherwise:
      If item.legKm at least 800:
        Return "Line haul freight".
      Otherwise:
        Return "Local courier".
`,
    },
    zh: {
      ruleName: '路由', paramName: '此件',
      source: `模块 履约.路由。

定义 货件 包含
  毛重 作为 整数，
  运距 作为 整数，
  时效等级 作为 整数。

规则 路由 给定 此件 作为 货件 产出 文本：
  如果 此件.时效等级 至少 3：
    返回 "航空急件"。
  否则：
    如果 此件.毛重 至少 30：
      返回 "干线货运"。
    否则：
      如果 此件.运距 至少 800：
        返回 "干线货运"。
      否则：
        返回 "本地快递"。
`,
    },
    de: {
      ruleName: 'leiten', paramName: 'paket',
      source: `Modul abwicklung.routing.

Definiere Sendung hat
  bruttoKg als Ganzzahl,
  streckeKm als Ganzzahl,
  slaStufe als Ganzzahl.

Regel leiten gegeben paket als Sendung liefert Text:
  wenn paket.slaStufe mindestens 3:
    gib zurück "Luftexpress".
  sonst:
    wenn paket.bruttoKg mindestens 30:
      gib zurück "Hauptlauf-Fracht".
    sonst:
      wenn paket.streckeKm mindestens 800:
        gib zurück "Hauptlauf-Fracht".
      sonst:
        gib zurück "Lokaler Kurier".
`,
    },
  },
  cases: [
    { id: 'SHP-9001', labelKey: 'air', input: { weightKg: 5, distanceKm: 1200, priority: 3 },
      expect: { en: 'Air express', zh: '航空急件', de: 'Luftexpress' } },
    { id: 'SHP-9002', labelKey: 'freight', input: { weightKg: 45, distanceKm: 350, priority: 1 },
      expect: { en: 'Line haul freight', zh: '干线货运', de: 'Hauptlauf-Fracht' } },
    { id: 'SHP-9003', labelKey: 'courier', input: { weightKg: 8, distanceKm: 60, priority: 1 },
      expect: { en: 'Local courier', zh: '本地快递', de: 'Lokaler Kurier' } },
  ],
};

export const VOCAB_DOMAINS: Record<VocabDomainId, VocabDomain> = {
  healthcare: HEALTHCARE,
  insurance: INSURANCE,
  logistics: LOGISTICS,
};

export const VOCAB_DOMAIN_IDS: VocabDomainId[] = ['healthcare', 'insurance', 'logistics'];

/** 当前语言的领域词汇 registry domain key（每语言独立注册，避免串味）。 */
function domainKey(domain: VocabDomain, loc: DemoLocale): string {
  return `${domain.id}-${loc}`;
}

/**
 * 把某语言的领域术语组装成 DomainVocabulary 并注入引擎（registerCustom）。
 * compile 时传同一 domain key + 对应 lexicon，行业术语即被翻译成 canonical。
 * 幂等：重复注册覆盖。返回该领域在该语言的 registry domain key（compile 用）。
 */
export function registerVocabForDomain(domain: VocabDomain, loc: DemoLocale): string {
  const localeTag = LOCALE_TAGS[loc];
  const key = domainKey(domain, loc);
  const rows: TermLikeRow[] = domain.terms.map((t, i) => ({
    domainTermId: `${key}-${i}`,
    domain: key,
    locale: localeTag,
    kind: t.kind,
    canonical: t.canonical,
    localized: t.localized[loc],
    parentCanonical: t.parent ?? null,
  }));
  const vocab = assembleDomainVocabularyFromLinks(rows, { domain: key, locale: localeTag, name: key });
  vocabularyRegistry.registerCustom(VOCAB_DEMO_TENANT, vocab);
  return key;
}

/** 当前语言的 lexicon（compile 用）。 */
export function lexiconFor(loc: DemoLocale): Lexicon {
  return LEXICONS[loc];
}

export type { DomainVocabulary };

// 领域词汇 demo 数据 + 逻辑：展示「用你行业自己的术语写规则，引擎照样编译执行」。
//
// 与信贷 demo（讲「可回放」）错开——这个讲「领域贴合/可读性」：业务人员用本行业说法，
// 不用学工程术语。三个领域（医疗/保险/物流）可切换，证明任意领域词汇都能注入引擎。
//
// 关键技术契约（已用生产引擎实证，见 vocab-demo.compile.test.ts）：
//  1. 规则用**行业术语**（localized）书写；compile(src, { lexicon, domain, tenantId })
//     经 vocabularyRegistry.registerCustom 注入的领域词汇，把行业术语翻译成 canonical IR。
//  2. **eval 输入必须用 canonical 字段名**（如 systolic 而非 sysBP）——领域词只在表层，
//     IR/运行时是规范名。这与信贷 demo 的标识符本地化是镜像关系。
//  3. registerCustom 的 key = `${tenantId}:${domain}:${locale}`；compile 传同一组 domain+tenantId。
//  4. ⚠️ 规则 param 名**不得是 struct localized 名的大小写变体**（如 struct `PatientCase`
//     时 param 取 `patientCase` 会被领域 canonicalizer 误匹配翻译→编译落空）。故 param 用
//     与 struct 无关的中性词（visit/filing/item）。

import {
  vocabularyRegistry,
  type DomainVocabulary,
} from '@/lib/aster-lexicon';
import {
  assembleDomainVocabularyFromLinks,
  type TermLikeRow,
} from '@/lib/domain-vocabulary-assemble';

/** demo 用固定匿名租户（公开页无 session）。 */
export const VOCAB_DEMO_TENANT = 'vocab-demo-anon';

export type VocabDomainId = 'healthcare' | 'insurance' | 'logistics';

/** 一条领域术语：canonical=引擎规范名，localized=行业说法。 */
export interface VocabTerm {
  kind: 'struct' | 'field';
  canonical: string;
  localized: string;
  /** field 的父 struct canonical 名。 */
  parent?: string;
}

/** 一个申请/案例输入（key = canonical 字段名，因为 IR 用规范名）。 */
export type CaseInput = Record<string, number>;

export interface VocabDomain {
  id: VocabDomainId;
  /** 领域展示名（i18n key 后缀）。 */
  module: string;
  typeNameCanonical: string;
  typeNameLocalized: string;
  ruleName: string;
  paramLocalized: string;
  terms: VocabTerm[];
  /** 规则源码（用行业术语书写）。 */
  source: string;
  /** demo 案例：每个含 canonical-key 输入 + 预期决策。 */
  cases: { id: string; labelKey: string; input: CaseInput; expect: string }[];
  /** 决策文本（与规则 Return 字面量逐字一致）。 */
  decisions: Record<string, string>;
}

// ── 医疗/临床准入 ──
const HEALTHCARE: VocabDomain = {
  id: 'healthcare',
  module: 'clinic.triage',
  typeNameCanonical: 'Patient',
  typeNameLocalized: 'PatientCase',
  ruleName: 'triage',
  paramLocalized: 'visit',
  terms: [
    { kind: 'struct', canonical: 'Patient', localized: 'PatientCase' },
    { kind: 'field', canonical: 'systolic', localized: 'sysBP', parent: 'Patient' },
    { kind: 'field', canonical: 'heartRate', localized: 'pulseBpm', parent: 'Patient' },
    { kind: 'field', canonical: 'age', localized: 'patientAge', parent: 'Patient' },
  ],
  source: `Module clinic.triage.

Define PatientCase has
  sysBP as Int,
  pulseBpm as Int,
  patientAge as Int.

Rule triage given visit as PatientCase, produce Text:
  If visit.sysBP at least 180:
    Return "Emergency — immediate review".
  Otherwise:
    If visit.sysBP at least 140 or visit.pulseBpm at least 110:
      Return "Refer to specialist".
    Otherwise:
      Return "Routine follow-up".
`,
  decisions: {
    emergency: 'Emergency — immediate review',
    refer: 'Refer to specialist',
    routine: 'Routine follow-up',
  },
  cases: [
    { id: 'PT-7781', labelKey: 'emergency', input: { systolic: 188, heartRate: 96, age: 67 }, expect: 'Emergency — immediate review' },
    { id: 'PT-7782', labelKey: 'refer', input: { systolic: 152, heartRate: 88, age: 54 }, expect: 'Refer to specialist' },
    { id: 'PT-7783', labelKey: 'routine', input: { systolic: 124, heartRate: 72, age: 41 }, expect: 'Routine follow-up' },
  ],
};

// ── 保险/理赔准入 ──
const INSURANCE: VocabDomain = {
  id: 'insurance',
  module: 'claims.intake',
  typeNameCanonical: 'Claim',
  typeNameLocalized: 'ClaimFile',
  ruleName: 'assess',
  paramLocalized: 'filing',
  terms: [
    { kind: 'struct', canonical: 'Claim', localized: 'ClaimFile' },
    { kind: 'field', canonical: 'claimAmount', localized: 'payoutAsk', parent: 'Claim' },
    { kind: 'field', canonical: 'deductible', localized: 'excess', parent: 'Claim' },
    { kind: 'field', canonical: 'priorClaims', localized: 'historyCount', parent: 'Claim' },
  ],
  source: `Module claims.intake.

Define ClaimFile has
  payoutAsk as Int,
  excess as Int,
  historyCount as Int.

Rule assess given filing as ClaimFile, produce Text:
  If filing.payoutAsk at most filing.excess:
    Return "Declined — below deductible".
  Otherwise:
    If filing.payoutAsk at least 50000 or filing.historyCount at least 3:
      Return "Refer to adjuster".
    Otherwise:
      Return "Auto-approve".
`,
  decisions: {
    declined: 'Declined — below deductible',
    refer: 'Refer to adjuster',
    approve: 'Auto-approve',
  },
  cases: [
    { id: 'CLM-3301', labelKey: 'approve', input: { claimAmount: 4200, deductible: 500, priorClaims: 1 }, expect: 'Auto-approve' },
    { id: 'CLM-3302', labelKey: 'refer', input: { claimAmount: 72000, deductible: 1000, priorClaims: 0 }, expect: 'Refer to adjuster' },
    { id: 'CLM-3303', labelKey: 'declined', input: { claimAmount: 300, deductible: 500, priorClaims: 2 }, expect: 'Declined — below deductible' },
  ],
};

// ── 物流/订单履约 ──
const LOGISTICS: VocabDomain = {
  id: 'logistics',
  module: 'fulfilment.routing',
  typeNameCanonical: 'Shipment',
  typeNameLocalized: 'Parcel',
  ruleName: 'route',
  paramLocalized: 'item',
  terms: [
    { kind: 'struct', canonical: 'Shipment', localized: 'Parcel' },
    { kind: 'field', canonical: 'weightKg', localized: 'grossKg', parent: 'Shipment' },
    { kind: 'field', canonical: 'distanceKm', localized: 'legKm', parent: 'Shipment' },
    { kind: 'field', canonical: 'priority', localized: 'slaTier', parent: 'Shipment' },
  ],
  source: `Module fulfilment.routing.

Define Parcel has
  grossKg as Int,
  legKm as Int,
  slaTier as Int.

Rule route given item as Parcel, produce Text:
  If item.slaTier at least 3:
    Return "Air express".
  Otherwise:
    If item.grossKg at least 30 or item.legKm at least 800:
      Return "Line haul freight".
    Otherwise:
      Return "Local courier".
`,
  decisions: {
    air: 'Air express',
    freight: 'Line haul freight',
    courier: 'Local courier',
  },
  cases: [
    { id: 'SHP-9001', labelKey: 'air', input: { weightKg: 5, distanceKm: 1200, priority: 3 }, expect: 'Air express' },
    { id: 'SHP-9002', labelKey: 'freight', input: { weightKg: 45, distanceKm: 350, priority: 1 }, expect: 'Line haul freight' },
    { id: 'SHP-9003', labelKey: 'courier', input: { weightKg: 8, distanceKm: 60, priority: 1 }, expect: 'Local courier' },
  ],
};

export const VOCAB_DOMAINS: Record<VocabDomainId, VocabDomain> = {
  healthcare: HEALTHCARE,
  insurance: INSURANCE,
  logistics: LOGISTICS,
};

export const VOCAB_DOMAIN_IDS: VocabDomainId[] = ['healthcare', 'insurance', 'logistics'];

/**
 * 把领域术语组装成 DomainVocabulary 并注入引擎（registerCustom）。
 * compile 时传同一 domain+tenantId 即可让行业术语被翻译成 canonical。
 * 幂等：同一 domain 重复注册覆盖即可。返回该领域的 locale（demo 固定 en-US）。
 */
export function registerVocabForDomain(domain: VocabDomain, locale = 'en-US'): DomainVocabulary {
  const rows: TermLikeRow[] = domain.terms.map((t, i) => ({
    domainTermId: `${domain.id}-${i}`,
    domain: domain.id,
    locale,
    kind: t.kind,
    canonical: t.canonical,
    localized: t.localized,
    parentCanonical: t.parent ?? null,
  }));
  const vocab = assembleDomainVocabularyFromLinks(rows, { domain: domain.id, locale, name: domain.id });
  vocabularyRegistry.registerCustom(VOCAB_DEMO_TENANT, vocab);
  return vocab;
}

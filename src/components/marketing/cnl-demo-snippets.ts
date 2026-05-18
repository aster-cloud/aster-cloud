// Per-locale CNL snippets for the landing page typewriter animation.
//
// 设计意图：
//   - 这里的 snippet 必须用对应语言的 Aster 关键字（en: Module/Rule，
//     zh: 模块/规则，de: Modul/Regel），不是简单地把 label 翻译一下
//   - 每条 snippet ≤ 8 行 / 行长 ≤ 50 字符，移动端不会触发水平滚动
//   - 三条 snippet 跨 finance / compliance / workflow 三个领域，复刻
//     英文版的覆盖面
//   - source 中的标识符（applicant / record / version 等）保留可读的
//     母语名称，让非英语读者也能直接看懂规则在判断什么
//
// Highlighter（cnl-demo.tsx::classify）按这里出现的关键字字符串匹配；
// 新增/改动关键字时务必同步更新 KEYWORDS_PER_LOCALE。

export interface CnlSnippet {
  /** Short label rendered above the code; rendered via t() at call site. */
  labelKey: string;
  /** Raw CNL source — preserve exact whitespace; the highlighter tokenizes per line. */
  source: string;
}

export type SupportedLocale = 'en' | 'zh' | 'de';

const EN_SNIPPETS: readonly CnlSnippet[] = [
  {
    labelKey: 'cnlDemo.loanEligibility',
    source: `Module aster.finance.loan.

Rule evaluate(applicant) given:
  applicant has income >= 50000 USD.
  applicant has credit_score >= 680.
  applicant has employment_years >= 2.
  decide approve.`,
  },
  {
    labelKey: 'cnlDemo.complianceCheck',
    source: `Module aster.compliance.gdpr.

Rule may_process(record) given:
  record has consent = true.
  record has region in EU.
  decide allow with audit_trail.`,
  },
  {
    labelKey: 'cnlDemo.workflowGuard',
    source: `Module aster.ops.deploy.

Rule can_release(version) given:
  version has tests_passed = true.
  version has reviewers >= 2.
  decide release otherwise hold.`,
  },
] as const;

const ZH_SNIPPETS: readonly CnlSnippet[] = [
  {
    labelKey: 'cnlDemo.loanEligibility',
    source: `模块 金融.贷款.审批。

规则 评估(申请人) 给定：
  申请人 包含 收入 >= 50000 CNY。
  申请人 包含 信用分 >= 680。
  申请人 包含 在职年限 >= 2。
  决定 批准。`,
  },
  {
    labelKey: 'cnlDemo.complianceCheck',
    source: `模块 合规.个人信息保护法。

规则 可处理(记录) 给定：
  记录 包含 用户同意 = 真。
  记录 包含 所在地区 在 大陆境内。
  决定 允许 含 审计轨迹。`,
  },
  {
    labelKey: 'cnlDemo.workflowGuard',
    source: `模块 运维.发布流程。

规则 可发布(版本) 给定：
  版本 包含 测试通过 = 真。
  版本 包含 审核人数 >= 2。
  决定 发布 否则 暂缓。`,
  },
] as const;

const DE_SNIPPETS: readonly CnlSnippet[] = [
  {
    labelKey: 'cnlDemo.loanEligibility',
    source: `Modul finanzen.kredit.pruefung.

Regel pruefen(antragsteller) gegeben:
  antragsteller hat einkommen >= 50000 EUR.
  antragsteller hat bonitaet >= 680.
  antragsteller hat berufsjahre >= 2.
  entscheide genehmigen.`,
  },
  {
    labelKey: 'cnlDemo.complianceCheck',
    source: `Modul compliance.dsgvo.

Regel darf_verarbeiten(datensatz) gegeben:
  datensatz hat einwilligung = wahr.
  datensatz hat region in EU.
  entscheide erlauben mit pruefspur.`,
  },
  {
    labelKey: 'cnlDemo.workflowGuard',
    source: `Modul betrieb.freigabe.

Regel kann_freigeben(version) gegeben:
  version hat tests_bestanden = wahr.
  version hat reviewer >= 2.
  entscheide freigeben sonst zurueckhalten.`,
  },
] as const;

const SNIPPETS_BY_LOCALE: Record<SupportedLocale, readonly CnlSnippet[]> = {
  en: EN_SNIPPETS,
  zh: ZH_SNIPPETS,
  de: DE_SNIPPETS,
};

export function getSnippetsForLocale(locale: string): readonly CnlSnippet[] {
  if (locale === 'zh' || locale.startsWith('zh-')) return SNIPPETS_BY_LOCALE.zh;
  if (locale === 'de' || locale.startsWith('de-')) return SNIPPETS_BY_LOCALE.de;
  return SNIPPETS_BY_LOCALE.en;
}

// Keywords per locale, mirrored by cnl-demo.tsx::classify(). Grouped by
// token class so the highlighter applies the same color regardless of
// language (Module/模块/Modul all = violet "structural").
export interface LocaleKeywords {
  structural: ReadonlySet<string>; // Module / 模块 / Modul ; Rule / 规则 / Regel
  relational: ReadonlySet<string>; // has / given / in
  control: ReadonlySet<string>;    // otherwise / if / then / with
  action: ReadonlySet<string>;     // decide / approve / allow / release / hold / audit_trail
}

const EN_KEYWORDS: LocaleKeywords = {
  structural: new Set(['Module', 'Rule']),
  relational: new Set(['has', 'given', 'in']),
  control: new Set(['otherwise', 'if', 'then', 'with']),
  action: new Set([
    'decide',
    'approve',
    'allow',
    'release',
    'hold',
    'audit_trail',
  ]),
};

const ZH_KEYWORDS: LocaleKeywords = {
  structural: new Set(['模块', '规则']),
  relational: new Set(['包含', '给定', '在']),
  control: new Set(['否则', '如果', '那么', '含']),
  action: new Set([
    '决定',
    '批准',
    '允许',
    '发布',
    '暂缓',
    '审计轨迹',
    '真',
  ]),
};

const DE_KEYWORDS: LocaleKeywords = {
  structural: new Set(['Modul', 'Regel']),
  relational: new Set(['hat', 'gegeben', 'in']),
  control: new Set(['sonst', 'wenn', 'dann', 'mit']),
  action: new Set([
    'entscheide',
    'genehmigen',
    'erlauben',
    'freigeben',
    'zurueckhalten',
    'pruefspur',
    'wahr',
  ]),
};

const KEYWORDS_BY_LOCALE: Record<SupportedLocale, LocaleKeywords> = {
  en: EN_KEYWORDS,
  zh: ZH_KEYWORDS,
  de: DE_KEYWORDS,
};

export function getKeywordsForLocale(locale: string): LocaleKeywords {
  if (locale === 'zh' || locale.startsWith('zh-')) return KEYWORDS_BY_LOCALE.zh;
  if (locale === 'de' || locale.startsWith('de-')) return KEYWORDS_BY_LOCALE.de;
  return KEYWORDS_BY_LOCALE.en;
}

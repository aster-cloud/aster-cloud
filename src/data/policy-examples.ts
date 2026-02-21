/**
 * 策略示例数据 - 多语言版本
 *
 * 支持三种语言的 CNL 策略示例：
 * - en-US: English
 * - zh-CN: 简体中文
 * - de-DE: Deutsch
 *
 * 每个示例都有三种语言的原生 CNL 源码
 */

// ============================================
// 类型定义
// ============================================

export type SupportedLocale = 'en-US' | 'zh-CN' | 'de-DE';

export type PolicyCategory = 'loan' | 'creditcard' | 'fraud' | 'healthcare' | 'auto-insurance';

export interface PolicyExampleInput {
  [key: string]: unknown;
}

export interface LocalizedMetadata {
  name: string;
  description: string;
}

export interface PolicyExample {
  id: string;
  category: PolicyCategory;
  groupId: string; // 使用 ID 而非本地化文本
  sources: Record<SupportedLocale, string>;
  metadata: Record<SupportedLocale, LocalizedMetadata>;
  defaultInput: PolicyExampleInput;
}

// ============================================
// 分组定义
// ============================================

export interface PolicyGroupDef {
  id: string;
  parentId: string | null;
  icon: string;
  names: Record<SupportedLocale, string>;
  children?: PolicyGroupDef[];
}

export const POLICY_GROUP_TREE: PolicyGroupDef[] = [
  {
    id: 'finance',
    parentId: null,
    icon: 'banknote',
    names: { 'en-US': 'Finance', 'zh-CN': '金融', 'de-DE': 'Finanzen' },
    children: [
      {
        id: 'loan',
        parentId: 'finance',
        icon: 'landmark',
        names: { 'en-US': 'Loan', 'zh-CN': '贷款', 'de-DE': 'Kredit' },
      },
      {
        id: 'creditcard',
        parentId: 'finance',
        icon: 'credit-card',
        names: { 'en-US': 'Credit Card', 'zh-CN': '信用卡', 'de-DE': 'Kreditkarte' },
      },
      {
        id: 'fraud',
        parentId: 'finance',
        icon: 'shield-alert',
        names: { 'en-US': 'Fraud Detection', 'zh-CN': '欺诈检测', 'de-DE': 'Betrugserkennung' },
      },
    ],
  },
  {
    id: 'healthcare',
    parentId: null,
    icon: 'heart-pulse',
    names: { 'en-US': 'Healthcare', 'zh-CN': '医疗', 'de-DE': 'Gesundheitswesen' },
    children: [
      {
        id: 'eligibility',
        parentId: 'healthcare',
        icon: 'clipboard-check',
        names: { 'en-US': 'Eligibility', 'zh-CN': '资格审核', 'de-DE': 'Berechtigung' },
      },
    ],
  },
  {
    id: 'insurance',
    parentId: null,
    icon: 'shield',
    names: { 'en-US': 'Insurance', 'zh-CN': '保险', 'de-DE': 'Versicherung' },
    children: [
      {
        id: 'auto',
        parentId: 'insurance',
        icon: 'car',
        names: { 'en-US': 'Auto Insurance', 'zh-CN': '汽车保险', 'de-DE': 'Kfz-Versicherung' },
      },
    ],
  },
];

// ============================================
// 策略源码 - 贷款审批
// ============================================

const LOAN_SOURCE_EN = `Module finance.loan.

Define Applicant has
  id,
  creditScore,
  income,
  age.

Define Decision has
  approved,
  reason,
  rate.

Rule evaluateLoan given applicant:
  If applicant.age less than 18:
    Return Decision with approved = false, reason = "Underage applicant", rate = 0.
  If applicant.creditScore less than 600:
    Return Decision with approved = false, reason = "Credit score too low", rate = 0.
  If applicant.creditScore greater than 750:
    Return Decision with approved = true, reason = "Excellent credit", rate = 350.
  If applicant.creditScore greater than 700:
    Return Decision with approved = true, reason = "Good credit", rate = 450.
  Return Decision with approved = true, reason = "Standard approval", rate = 550.
`;

const LOAN_SOURCE_ZH = `模块 金融.贷款。

定义 申请人 包含
  编号，
  信用评分，
  收入，
  年龄。

定义 决定 包含
  批准，
  理由，
  利率。

规则 评估贷款 给定 申请人：
  如果 申请人.年龄 小于 18：
    返回 决定 包含 批准 = 假, 理由 = 「申请人未成年」, 利率 = 0。
  如果 申请人.信用评分 小于 600：
    返回 决定 包含 批准 = 假, 理由 = 「信用评分过低」, 利率 = 0。
  如果 申请人.信用评分 大于 750：
    返回 决定 包含 批准 = 真, 理由 = 「信用优秀」, 利率 = 350。
  如果 申请人.信用评分 大于 700：
    返回 决定 包含 批准 = 真, 理由 = 「信用良好」, 利率 = 450。
  返回 决定 包含 批准 = 真, 理由 = 「标准审批」, 利率 = 550。
`;

const LOAN_SOURCE_DE = `Modul finanz.kredit.

Definiere Antragsteller hat
  kennung,
  bonitaet,
  einkommen,
  alter.

Definiere Entscheidung hat
  genehmigt,
  begruendung,
  zinssatz.

Regel kreditPruefen gegeben antragsteller:
  wenn antragsteller.alter kleiner als 18:
    gib zurueck Entscheidung mit genehmigt = falsch, begruendung = "Minderjaehriger Antragsteller", zinssatz = 0.
  wenn antragsteller.bonitaet kleiner als 600:
    gib zurueck Entscheidung mit genehmigt = falsch, begruendung = "Bonitaet zu niedrig", zinssatz = 0.
  wenn antragsteller.bonitaet groesser als 750:
    gib zurueck Entscheidung mit genehmigt = wahr, begruendung = "Ausgezeichnete Bonitaet", zinssatz = 350.
  wenn antragsteller.bonitaet groesser als 700:
    gib zurueck Entscheidung mit genehmigt = wahr, begruendung = "Gute Bonitaet", zinssatz = 450.
  gib zurueck Entscheidung mit genehmigt = wahr, begruendung = "Standardgenehmigung", zinssatz = 550.
`;

// ============================================
// 策略源码 - 医疗资格
// ============================================

const HEALTHCARE_SOURCE_EN = `Module healthcare.eligibility.

Define Patient has
  id,
  age,
  hasInsurance,
  insuranceType.

Define Service has
  code,
  name,
  price.

Define Result has
  eligible,
  coverage,
  patientCost,
  reason.

Rule checkEligibility given patient, service:
  If not patient.hasInsurance:
    Return Result with eligible = false, coverage = 0, patientCost = service.price, reason = "No insurance".
  If patient.age less than 18:
    Return Result with eligible = true, coverage = 90, patientCost = service.price times 10 divided by 100, reason = "Minor coverage".
  If patient.age greater than 65:
    Return Result with eligible = true, coverage = 85, patientCost = service.price times 15 divided by 100, reason = "Senior coverage".
  Return Result with eligible = true, coverage = 70, patientCost = service.price times 30 divided by 100, reason = "Standard coverage".
`;

const HEALTHCARE_SOURCE_ZH = `模块 医疗.资格审核。

定义 患者 包含
  编号，
  年龄，
  有保险，
  保险类型。

定义 服务 包含
  代码，
  名称，
  价格。

定义 审核结果 包含
  合格，
  覆盖率，
  患者费用，
  理由。

规则 检查资格 给定 患者，服务：
  如果 非 患者.有保险：
    返回 审核结果 包含 合格 = 假, 覆盖率 = 0, 患者费用 = 服务.价格, 理由 = 「无保险」。
  如果 患者.年龄 小于 18：
    返回 审核结果 包含 合格 = 真, 覆盖率 = 90, 患者费用 = 服务.价格 乘 10 除以 100, 理由 = 「未成年人覆盖」。
  如果 患者.年龄 大于 65：
    返回 审核结果 包含 合格 = 真, 覆盖率 = 85, 患者费用 = 服务.价格 乘 15 除以 100, 理由 = 「老年人覆盖」。
  返回 审核结果 包含 合格 = 真, 覆盖率 = 70, 患者费用 = 服务.价格 乘 30 除以 100, 理由 = 「标准覆盖」。
`;

const HEALTHCARE_SOURCE_DE = `Modul gesundheit.berechtigung.

Definiere Patient hat
  kennung,
  alter,
  hatVersicherung,
  versicherungstyp.

Definiere Leistung hat
  code,
  name,
  preis.

Definiere Ergebnis hat
  berechtigt,
  deckung,
  patientenkosten,
  begruendung.

Regel berechtigungPruefen gegeben patient, leistung:
  wenn nicht patient.hatVersicherung:
    gib zurueck Ergebnis mit berechtigt = falsch, deckung = 0, patientenkosten = leistung.preis, begruendung = "Keine Versicherung".
  wenn patient.alter kleiner als 18:
    gib zurueck Ergebnis mit berechtigt = wahr, deckung = 90, patientenkosten = leistung.preis mal 10 geteilt durch 100, begruendung = "Minderjaehrige Deckung".
  wenn patient.alter groesser als 65:
    gib zurueck Ergebnis mit berechtigt = wahr, deckung = 85, patientenkosten = leistung.preis mal 15 geteilt durch 100, begruendung = "Senioren Deckung".
  gib zurueck Ergebnis mit berechtigt = wahr, deckung = 70, patientenkosten = leistung.preis mal 30 geteilt durch 100, begruendung = "Standarddeckung".
`;

// ============================================
// 策略源码 - 汽车保险
// ============================================

const AUTO_SOURCE_EN = `Module insurance.auto.

Define Driver has
  id,
  age,
  yearsLicensed,
  accidents,
  violations.

Define Vehicle has
  vin,
  year,
  value,
  safetyRating.

Define Quote has
  approved,
  premium,
  deductible,
  reason.

Rule generateQuote given driver, vehicle:
  If driver.age less than 18:
    Return Quote with approved = false, premium = 0, deductible = 0, reason = "Driver under 18".
  If driver.accidents greater than 3:
    Return Quote with approved = false, premium = 0, deductible = 0, reason = "Too many accidents".
  Let basePremium be calculateBase with driver, vehicle.
  Let riskFactor be calculateRisk with driver.
  Let finalPremium be basePremium times riskFactor divided by 100.
  Return Quote with approved = true, premium = finalPremium, deductible = 500, reason = "Approved".

Rule calculateBase given driver, vehicle:
  If driver.age less than 25:
    Return 300.
  If driver.age less than 65:
    Return 200.
  Return 250.

Rule calculateRisk given driver:
  Let base be 100.
  If driver.accidents greater than 0:
    Let base be base plus driver.accidents times 20.
  If driver.violations greater than 0:
    Let base be base plus driver.violations times 10.
  Return base.
`;

const AUTO_SOURCE_ZH = `模块 保险.汽车。

定义 驾驶员 包含
  编号，
  年龄，
  驾龄，
  事故数，
  违章数。

定义 车辆 包含
  车架号，
  年份，
  价值，
  安全评级。

定义 报价 包含
  批准，
  保费，
  免赔额，
  理由。

规则 生成报价 给定 驾驶员，车辆：
  如果 驾驶员.年龄 小于 18：
    返回 报价 包含 批准 = 假, 保费 = 0, 免赔额 = 0, 理由 = 「驾驶员未满18岁」。
  如果 驾驶员.事故数 大于 3：
    返回 报价 包含 批准 = 假, 保费 = 0, 免赔额 = 0, 理由 = 「事故过多」。
  令 基础保费 为 计算基础(驾驶员, 车辆)。
  令 风险系数 为 计算风险(驾驶员)。
  令 最终保费 为 基础保费 乘 风险系数 除以 100。
  返回 报价 包含 批准 = 真, 保费 = 最终保费, 免赔额 = 500, 理由 = 「已批准」。

规则 计算基础 给定 驾驶员，车辆：
  如果 驾驶员.年龄 小于 25：
    返回 300。
  如果 驾驶员.年龄 小于 65：
    返回 200。
  返回 250。

规则 计算风险 给定 驾驶员：
  令 基数 为 100。
  如果 驾驶员.事故数 大于 0：
    令 基数 为 基数 加 驾驶员.事故数 乘 20。
  如果 驾驶员.违章数 大于 0：
    令 基数 为 基数 加 驾驶员.违章数 乘 10。
  返回 基数。
`;

const AUTO_SOURCE_DE = `Modul versicherung.kfz.

Definiere Fahrer hat
  kennung,
  alter,
  fuehrerscheinJahre,
  unfaelle,
  verstoesse.

Definiere Fahrzeug hat
  fahrgestellnummer,
  baujahr,
  wert,
  sicherheitsbewertung.

Definiere Angebot hat
  genehmigt,
  praemie,
  selbstbeteiligung,
  begruendung.

Regel angebotErstellen gegeben fahrer, fahrzeug:
  wenn fahrer.alter kleiner als 18:
    gib zurueck Angebot mit genehmigt = falsch, praemie = 0, selbstbeteiligung = 0, begruendung = "Fahrer unter 18".
  wenn fahrer.unfaelle groesser als 3:
    gib zurueck Angebot mit genehmigt = falsch, praemie = 0, selbstbeteiligung = 0, begruendung = "Zu viele Unfaelle".
  sei basisPraemie gleich basisBerechnen mit fahrer, fahrzeug.
  sei risikoFaktor gleich risikoBerechnen mit fahrer.
  sei endPraemie gleich basisPraemie mal risikoFaktor geteilt durch 100.
  gib zurueck Angebot mit genehmigt = wahr, praemie = endPraemie, selbstbeteiligung = 500, begruendung = "Genehmigt".

Regel basisBerechnen gegeben fahrer, fahrzeug:
  wenn fahrer.alter kleiner als 25:
    gib zurueck 300.
  wenn fahrer.alter kleiner als 65:
    gib zurueck 200.
  gib zurueck 250.

Regel risikoBerechnen gegeben fahrer:
  sei basis gleich 100.
  wenn fahrer.unfaelle groesser als 0:
    sei basis gleich basis plus fahrer.unfaelle mal 20.
  wenn fahrer.verstoesse groesser als 0:
    sei basis gleich basis plus fahrer.verstoesse mal 10.
  gib zurueck basis.
`;

// ============================================
// 策略源码 - 欺诈检测
// ============================================

const FRAUD_SOURCE_EN = `Module finance.fraud.

Define Transaction has
  id,
  accountId,
  amount,
  timestamp.

Define AccountHistory has
  accountId,
  averageAmount,
  suspiciousCount,
  accountAge.

Define FraudResult has
  suspicious,
  riskScore,
  reason.

Rule detectFraud given transaction, history:
  If transaction.amount greater than 1000000:
    Return FraudResult with suspicious = true, riskScore = 100, reason = "Extremely large transaction".
  If history.suspiciousCount greater than 5:
    Return FraudResult with suspicious = true, riskScore = 85, reason = "High suspicious activity".
  If history.accountAge less than 30:
    Return FraudResult with suspicious = true, riskScore = 70, reason = "New account risk".
  If transaction.amount greater than history.averageAmount times 10:
    Return FraudResult with suspicious = true, riskScore = 60, reason = "Unusual amount".
  Return FraudResult with suspicious = false, riskScore = 10, reason = "Normal transaction".
`;

const FRAUD_SOURCE_ZH = `模块 金融.欺诈。

定义 交易 包含
  编号，
  账户号，
  金额，
  时间戳。

定义 账户历史 包含
  账户号，
  平均金额，
  可疑次数，
  账龄。

定义 欺诈结果 包含
  可疑，
  风险评分，
  理由。

规则 检测欺诈 给定 交易，历史：
  如果 交易.金额 大于 1000000：
    返回 欺诈结果 包含 可疑 = 真, 风险评分 = 100, 理由 = 「超大额交易」。
  如果 历史.可疑次数 大于 5：
    返回 欺诈结果 包含 可疑 = 真, 风险评分 = 85, 理由 = 「高度可疑活动」。
  如果 历史.账龄 小于 30：
    返回 欺诈结果 包含 可疑 = 真, 风险评分 = 70, 理由 = 「新账户风险」。
  如果 交易.金额 大于 历史.平均金额 乘 10：
    返回 欺诈结果 包含 可疑 = 真, 风险评分 = 60, 理由 = 「异常金额」。
  返回 欺诈结果 包含 可疑 = 假, 风险评分 = 10, 理由 = 「正常交易」。
`;

const FRAUD_SOURCE_DE = `Modul finanz.betrug.

Definiere Transaktion hat
  kennung,
  kontoId,
  betrag,
  zeitstempel.

Definiere KontoHistorie hat
  kontoId,
  durchschnittsbetrag,
  verdaechtigeAnzahl,
  kontoalter.

Definiere BetrugsErgebnis hat
  verdaechtig,
  risikoBewertung,
  begruendung.

Regel betrugErkennen gegeben transaktion, historie:
  wenn transaktion.betrag groesser als 1000000:
    gib zurueck BetrugsErgebnis mit verdaechtig = wahr, risikoBewertung = 100, begruendung = "Extrem grosse Transaktion".
  wenn historie.verdaechtigeAnzahl groesser als 5:
    gib zurueck BetrugsErgebnis mit verdaechtig = wahr, risikoBewertung = 85, begruendung = "Hohe verdaechtige Aktivitaet".
  wenn historie.kontoalter kleiner als 30:
    gib zurueck BetrugsErgebnis mit verdaechtig = wahr, risikoBewertung = 70, begruendung = "Neues Konto Risiko".
  wenn transaktion.betrag groesser als historie.durchschnittsbetrag mal 10:
    gib zurueck BetrugsErgebnis mit verdaechtig = wahr, risikoBewertung = 60, begruendung = "Ungewoehnlicher Betrag".
  gib zurueck BetrugsErgebnis mit verdaechtig = falsch, risikoBewertung = 10, begruendung = "Normale Transaktion".
`;

// ============================================
// 策略源码 - 信用卡审批
// ============================================

const CREDITCARD_SOURCE_EN = `Module finance.creditcard.

Define Applicant has
  id,
  age,
  income,
  creditScore,
  existingCards.

Define Application has
  requestedLimit,
  cardType.

Define Decision has
  approved,
  approvedLimit,
  interestRate,
  reason.

Rule evaluateApplication given applicant, application:
  If applicant.age less than 21:
    Return Decision with approved = false, approvedLimit = 0, interestRate = 0, reason = "Age below 21".
  If applicant.creditScore less than 550:
    Return Decision with approved = false, approvedLimit = 0, interestRate = 0, reason = "Credit score too low".
  If applicant.existingCards greater than 5:
    Return Decision with approved = false, approvedLimit = 0, interestRate = 0, reason = "Too many existing cards".
  Let limit be determineLimit with applicant, application.
  Let rate be determineRate with applicant.
  Return Decision with approved = true, approvedLimit = limit, interestRate = rate, reason = "Approved".

Rule determineLimit given applicant, application:
  If applicant.creditScore greater than 750:
    Return application.requestedLimit.
  If applicant.creditScore greater than 700:
    Return application.requestedLimit times 80 divided by 100.
  Return application.requestedLimit times 50 divided by 100.

Rule determineRate given applicant:
  If applicant.creditScore greater than 750:
    Return 1299.
  If applicant.creditScore greater than 700:
    Return 1599.
  Return 1999.
`;

const CREDITCARD_SOURCE_ZH = `模块 金融.信用卡。

定义 申请人 包含
  编号，
  年龄，
  收入，
  信用评分，
  现有卡数。

定义 申请 包含
  申请额度，
  卡类型。

定义 决定 包含
  批准，
  批准额度，
  利率，
  理由。

规则 评估申请 给定 申请人，申请：
  如果 申请人.年龄 小于 21：
    返回 决定 包含 批准 = 假, 批准额度 = 0, 利率 = 0, 理由 = 「年龄未满21岁」。
  如果 申请人.信用评分 小于 550：
    返回 决定 包含 批准 = 假, 批准额度 = 0, 利率 = 0, 理由 = 「信用评分过低」。
  如果 申请人.现有卡数 大于 5：
    返回 决定 包含 批准 = 假, 批准额度 = 0, 利率 = 0, 理由 = 「现有卡数过多」。
  令 额度 为 确定额度(申请人, 申请)。
  令 利率值 为 确定利率(申请人)。
  返回 决定 包含 批准 = 真, 批准额度 = 额度, 利率 = 利率值, 理由 = 「已批准」。

规则 确定额度 给定 申请人，申请：
  如果 申请人.信用评分 大于 750：
    返回 申请.申请额度。
  如果 申请人.信用评分 大于 700：
    返回 申请.申请额度 乘 80 除以 100。
  返回 申请.申请额度 乘 50 除以 100。

规则 确定利率 给定 申请人：
  如果 申请人.信用评分 大于 750：
    返回 1299。
  如果 申请人.信用评分 大于 700：
    返回 1599。
  返回 1999。
`;

const CREDITCARD_SOURCE_DE = `Modul finanz.kreditkarte.

Definiere Antragsteller hat
  kennung,
  alter,
  einkommen,
  bonitaet,
  vorhandeneKarten.

Definiere Antrag hat
  gewuenschtesLimit,
  kartentyp.

Definiere Entscheidung hat
  genehmigt,
  genehmigterLimit,
  zinssatz,
  begruendung.

Regel antragAuswerten gegeben antragsteller, antrag:
  wenn antragsteller.alter kleiner als 21:
    gib zurueck Entscheidung mit genehmigt = falsch, genehmigterLimit = 0, zinssatz = 0, begruendung = "Alter unter 21".
  wenn antragsteller.bonitaet kleiner als 550:
    gib zurueck Entscheidung mit genehmigt = falsch, genehmigterLimit = 0, zinssatz = 0, begruendung = "Bonitaet zu niedrig".
  wenn antragsteller.vorhandeneKarten groesser als 5:
    gib zurueck Entscheidung mit genehmigt = falsch, genehmigterLimit = 0, zinssatz = 0, begruendung = "Zu viele vorhandene Karten".
  sei limit gleich limitBestimmen mit antragsteller, antrag.
  sei rate gleich zinsBestimmen mit antragsteller.
  gib zurueck Entscheidung mit genehmigt = wahr, genehmigterLimit = limit, zinssatz = rate, begruendung = "Genehmigt".

Regel limitBestimmen gegeben antragsteller, antrag:
  wenn antragsteller.bonitaet groesser als 750:
    gib zurueck antrag.gewuenschtesLimit.
  wenn antragsteller.bonitaet groesser als 700:
    gib zurueck antrag.gewuenschtesLimit mal 80 geteilt durch 100.
  gib zurueck antrag.gewuenschtesLimit mal 50 geteilt durch 100.

Regel zinsBestimmen gegeben antragsteller:
  wenn antragsteller.bonitaet groesser als 750:
    gib zurueck 1299.
  wenn antragsteller.bonitaet groesser als 700:
    gib zurueck 1599.
  gib zurueck 1999.
`;

// ============================================
// 策略示例定义
// ============================================

const loanExample: PolicyExample = {
  id: 'loan-evaluation',
  category: 'loan',
  groupId: 'loan',
  sources: {
    'en-US': LOAN_SOURCE_EN,
    'zh-CN': LOAN_SOURCE_ZH,
    'de-DE': LOAN_SOURCE_DE,
  },
  metadata: {
    'en-US': {
      name: 'Loan Evaluation',
      description: 'Evaluate loan applications based on credit score and age',
    },
    'zh-CN': {
      name: '贷款评估',
      description: '根据信用评分和年龄评估贷款申请',
    },
    'de-DE': {
      name: 'Kreditbewertung',
      description: 'Kreditantraege basierend auf Bonitaet und Alter bewerten',
    },
  },
  defaultInput: {
    applicant: {
      id: 'APP-001',
      creditScore: 720,
      income: 75000,
      age: 35,
    },
  },
};

const healthcareExample: PolicyExample = {
  id: 'healthcare-eligibility',
  category: 'healthcare',
  groupId: 'eligibility',
  sources: {
    'en-US': HEALTHCARE_SOURCE_EN,
    'zh-CN': HEALTHCARE_SOURCE_ZH,
    'de-DE': HEALTHCARE_SOURCE_DE,
  },
  metadata: {
    'en-US': {
      name: 'Healthcare Eligibility',
      description: 'Check patient eligibility for medical services',
    },
    'zh-CN': {
      name: '医疗资格审核',
      description: '检查患者的医疗服务资格',
    },
    'de-DE': {
      name: 'Gesundheits-Berechtigung',
      description: 'Patientenberechtigung fuer medizinische Leistungen pruefen',
    },
  },
  defaultInput: {
    patient: {
      id: 'PAT-001',
      age: 45,
      hasInsurance: true,
      insuranceType: 'Standard',
    },
    service: {
      code: 'SVC-001',
      name: 'Annual Checkup',
      price: 500,
    },
  },
};

const autoInsuranceExample: PolicyExample = {
  id: 'auto-insurance-quote',
  category: 'auto-insurance',
  groupId: 'auto',
  sources: {
    'en-US': AUTO_SOURCE_EN,
    'zh-CN': AUTO_SOURCE_ZH,
    'de-DE': AUTO_SOURCE_DE,
  },
  metadata: {
    'en-US': {
      name: 'Auto Insurance Quote',
      description: 'Generate auto insurance quotes based on driver and vehicle information',
    },
    'zh-CN': {
      name: '汽车保险报价',
      description: '根据驾驶员和车辆信息生成汽车保险报价',
    },
    'de-DE': {
      name: 'Kfz-Versicherungsangebot',
      description: 'Kfz-Versicherungsangebote basierend auf Fahrer- und Fahrzeuginformationen erstellen',
    },
  },
  defaultInput: {
    driver: {
      id: 'DRV-001',
      age: 35,
      yearsLicensed: 15,
      accidents: 0,
      violations: 1,
    },
    vehicle: {
      vin: '1HGBH41JXMN109186',
      year: 2022,
      value: 28000,
      safetyRating: 9,
    },
  },
};

const fraudExample: PolicyExample = {
  id: 'fraud-detection',
  category: 'fraud',
  groupId: 'fraud',
  sources: {
    'en-US': FRAUD_SOURCE_EN,
    'zh-CN': FRAUD_SOURCE_ZH,
    'de-DE': FRAUD_SOURCE_DE,
  },
  metadata: {
    'en-US': {
      name: 'Fraud Detection',
      description: 'Detect potentially fraudulent transactions',
    },
    'zh-CN': {
      name: '欺诈检测',
      description: '检测潜在的欺诈交易',
    },
    'de-DE': {
      name: 'Betrugserkennung',
      description: 'Potenziell betruegerische Transaktionen erkennen',
    },
  },
  defaultInput: {
    transaction: {
      id: 'TXN-001',
      accountId: 'ACC-001',
      amount: 500,
      timestamp: 1704067200,
    },
    history: {
      accountId: 'ACC-001',
      averageAmount: 450,
      suspiciousCount: 0,
      accountAge: 365,
    },
  },
};

const creditcardExample: PolicyExample = {
  id: 'creditcard-application',
  category: 'creditcard',
  groupId: 'creditcard',
  sources: {
    'en-US': CREDITCARD_SOURCE_EN,
    'zh-CN': CREDITCARD_SOURCE_ZH,
    'de-DE': CREDITCARD_SOURCE_DE,
  },
  metadata: {
    'en-US': {
      name: 'Credit Card Application',
      description: 'Evaluate credit card applications and determine credit limits',
    },
    'zh-CN': {
      name: '信用卡申请',
      description: '评估信用卡申请并确定信用额度',
    },
    'de-DE': {
      name: 'Kreditkartenantrag',
      description: 'Kreditkartenantraege auswerten und Kreditlimits festlegen',
    },
  },
  defaultInput: {
    applicant: {
      id: 'CCA-001',
      age: 32,
      income: 85000,
      creditScore: 740,
      existingCards: 2,
    },
    application: {
      requestedLimit: 10000,
      cardType: 'Standard',
    },
  },
};

// ============================================
// 导出
// ============================================

export const POLICY_EXAMPLES: PolicyExample[] = [
  loanExample,
  healthcareExample,
  autoInsuranceExample,
  fraudExample,
  creditcardExample,
];

// 按类别分组
export const POLICY_EXAMPLES_BY_CATEGORY: Record<PolicyCategory, PolicyExample[]> = {
  loan: POLICY_EXAMPLES.filter((e) => e.category === 'loan'),
  creditcard: POLICY_EXAMPLES.filter((e) => e.category === 'creditcard'),
  fraud: POLICY_EXAMPLES.filter((e) => e.category === 'fraud'),
  healthcare: POLICY_EXAMPLES.filter((e) => e.category === 'healthcare'),
  'auto-insurance': POLICY_EXAMPLES.filter((e) => e.category === 'auto-insurance'),
};

// ============================================
// 辅助函数
// ============================================

/**
 * 获取示例的源码（根据语言）
 */
export function getExampleSource(example: PolicyExample, locale: SupportedLocale): string {
  return example.sources[locale] || example.sources['en-US'];
}

/**
 * 获取示例名称（根据语言）
 */
export function getExampleName(example: PolicyExample, locale: SupportedLocale | string): string {
  const normalizedLocale = normalizeLocale(locale);
  return example.metadata[normalizedLocale]?.name || example.metadata['en-US'].name;
}

/**
 * 获取示例描述（根据语言）
 */
export function getExampleDescription(example: PolicyExample, locale: SupportedLocale | string): string {
  const normalizedLocale = normalizeLocale(locale);
  return example.metadata[normalizedLocale]?.description || example.metadata['en-US'].description;
}

/**
 * 获取分组名称（根据语言）
 */
export function getGroupName(group: PolicyGroupDef, locale: SupportedLocale | string): string {
  const normalizedLocale = normalizeLocale(locale);
  return group.names[normalizedLocale] || group.names['en-US'];
}

/**
 * 规范化 locale 字符串
 */
export function normalizeLocale(locale: string): SupportedLocale {
  if (locale.startsWith('zh')) return 'zh-CN';
  if (locale.startsWith('de')) return 'de-DE';
  return 'en-US';
}

/**
 * 类别标签映射
 */
export const CATEGORY_LABELS: Record<PolicyCategory, Record<SupportedLocale, string>> = {
  loan: { 'en-US': 'Loan', 'zh-CN': '贷款', 'de-DE': 'Kredit' },
  creditcard: { 'en-US': 'Credit Card', 'zh-CN': '信用卡', 'de-DE': 'Kreditkarte' },
  fraud: { 'en-US': 'Fraud Detection', 'zh-CN': '欺诈检测', 'de-DE': 'Betrugserkennung' },
  healthcare: { 'en-US': 'Healthcare', 'zh-CN': '医疗', 'de-DE': 'Gesundheitswesen' },
  'auto-insurance': { 'en-US': 'Auto Insurance', 'zh-CN': '汽车保险', 'de-DE': 'Kfz-Versicherung' },
};

/**
 * 获取类别标签
 */
export function getCategoryLabel(category: string, locale: SupportedLocale | string): string {
  const normalizedLocale = normalizeLocale(locale);
  const labels = CATEGORY_LABELS[category as PolicyCategory];
  if (!labels) return category;
  return labels[normalizedLocale] || labels['en-US'];
}

/**
 * 根据分组 ID 获取示例
 */
export function getExamplesByGroupId(groupId: string): PolicyExample[] {
  return POLICY_EXAMPLES.filter((e) => e.groupId === groupId);
}

/**
 * 查找分组定义
 */
export function findGroupById(groupId: string): PolicyGroupDef | undefined {
  function search(groups: PolicyGroupDef[]): PolicyGroupDef | undefined {
    for (const group of groups) {
      if (group.id === groupId) return group;
      if (group.children) {
        const found = search(group.children);
        if (found) return found;
      }
    }
    return undefined;
  }
  return search(POLICY_GROUP_TREE);
}

/**
 * 策略示例数据
 *
 * 包含来自 aster-lang 的真实策略示例，用于演示和测试
 * 每个示例包含：CNL 源代码、默认输入数据、语言设置
 */

export interface PolicyExampleInput {
  [key: string]: unknown;
}

export interface PolicyExample {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  locale: 'en-US' | 'zh-CN' | 'de-DE';
  category: 'loan' | 'insurance' | 'healthcare' | 'verification';
  source: string;
  defaultInput: PolicyExampleInput;
}

// ============================================
// 中文策略示例
// ============================================

/**
 * 年龄检查策略
 * 演示基本的条件判断和返回值
 */
const ageCheckZh: PolicyExample = {
  id: 'age-check-zh',
  name: 'Age Check',
  nameZh: '年龄检查',
  description: 'Simple age validation returning boolean',
  descriptionZh: '简单的年龄验证，返回布尔值',
  locale: 'zh-CN',
  category: 'loan',
  source: `【模块】金融.验证。

检查年龄 入参 年龄：整数，产出 布尔：
  若 年龄 小于 18：
    返回 假。
  若 年龄 大于 65：
    返回 假。
  返回 真。`,
  defaultInput: {
    年龄: 25,
  },
};

/**
 * 贷款金额检查策略
 * 演示数值比较和简单计算
 */
const loanAmountCheckZh: PolicyExample = {
  id: 'loan-amount-check-zh',
  name: 'Loan Amount Check',
  nameZh: '贷款金额检查',
  description: 'Check if loan amount is within limits',
  descriptionZh: '检查贷款金额是否在限额内',
  locale: 'zh-CN',
  category: 'loan',
  source: `【模块】金融.贷款检查。

【定义】贷款申请 包含 申请人编号：文本，金额：整数，年收入：整数。

检查金额 入参 申请：贷款申请，产出 布尔：
  若 申请.金额 小于 1000：
    返回 假。
  若 申请.金额 大于 1000000：
    返回 假。
  令 最大贷款 为 申请.年收入 乘以 5。
  若 申请.金额 大于 最大贷款：
    返回 假。
  返回 真。`,
  defaultInput: {
    申请: {
      申请人编号: 'A001',
      金额: 100000,
      年收入: 50000,
    },
  },
};

/**
 * 信用评分检查策略
 * 演示多条件验证
 */
const creditScoreCheckZh: PolicyExample = {
  id: 'credit-score-check-zh',
  name: 'Credit Score Check',
  nameZh: '信用评分检查',
  description: 'Evaluate credit score and return risk level',
  descriptionZh: '评估信用评分并返回风险等级',
  locale: 'zh-CN',
  category: 'loan',
  source: `【模块】金融.信用检查。

评估信用 入参 评分：整数，产出 整数：
  若 评分 小于 550：
    返回 0。
  若 评分 小于 650：
    返回 1。
  若 评分 小于 750：
    返回 2。
  返回 3。`,
  defaultInput: {
    评分: 720,
  },
};

// ============================================
// 英文策略示例
// ============================================

/**
 * Simple Age Check (English)
 * Basic age validation
 */
const ageCheckEn: PolicyExample = {
  id: 'age-check-en',
  name: 'Age Check',
  nameZh: '年龄检查',
  description: 'Simple age validation returning boolean',
  descriptionZh: '简单的年龄验证，返回布尔值',
  locale: 'en-US',
  category: 'loan',
  source: `This module is demo.validation.age.

To checkAge with age: Int, produce Bool:
  If <(age, 18),:
    Return false.
  If >(age, 65),:
    Return false.
  Return true.`,
  defaultInput: {
    age: 25,
  },
};

/**
 * Simple Loan Evaluation (English)
 * Basic loan approval based on credit score and income
 */
const simpleLoanEn: PolicyExample = {
  id: 'simple-loan-en',
  name: 'Simple Loan Evaluation',
  nameZh: '简单贷款评估',
  description: 'Basic loan approval based on credit score and income',
  descriptionZh: '基于信用评分和收入的基础贷款审批',
  locale: 'en-US',
  category: 'loan',
  source: `This module is demo.loan.simple.

Define LoanApplication with applicantId: Text, creditScore: Int, annualIncome: Int, requestedAmount: Int, employmentYears: Int.

To evaluateLoan with application: LoanApplication, produce Bool:
  If <(application.creditScore, 600),:
    Return false.
  If <(application.annualIncome, 30000),:
    Return false.
  Let maxLoanAmount be *(application.annualIncome, 3).
  If >(application.requestedAmount, maxLoanAmount),:
    Return false.
  If <(application.employmentYears, 1),:
    Return false.
  Return true.`,
  defaultInput: {
    application: {
      applicantId: 'APP-001',
      creditScore: 720,
      annualIncome: 85000,
      requestedAmount: 50000,
      employmentYears: 5,
    },
  },
};

/**
 * Age Factor Calculator
 * Calculate insurance age factor
 */
const ageFactorEn: PolicyExample = {
  id: 'age-factor-en',
  name: 'Age Factor Calculator',
  nameZh: '年龄因子计算',
  description: 'Calculate age factor for insurance premium',
  descriptionZh: '计算保险费的年龄因子',
  locale: 'en-US',
  category: 'insurance',
  source: `This module is demo.insurance.factor.

To calculateAgeFactor with age: Int, produce Int:
  If <(age, 25),:
    Return 150.
  If <(age, 35),:
    Return 120.
  If <(age, 55),:
    Return 100.
  If <(age, 70),:
    Return 130.
  Return 160.`,
  defaultInput: {
    age: 35,
  },
};

/**
 * Health Score Evaluator
 * Evaluate health score for insurance
 */
const healthScoreEn: PolicyExample = {
  id: 'health-score-en',
  name: 'Health Score Evaluator',
  nameZh: '健康评分评估',
  description: 'Evaluate health score for insurance eligibility',
  descriptionZh: '评估保险资格的健康评分',
  locale: 'en-US',
  category: 'healthcare',
  source: `This module is demo.healthcare.score.

Define HealthProfile with age: Int, bmi: Int, smoker: Bool, exerciseHours: Int.

To evaluateHealth with profile: HealthProfile, produce Int:
  Let score be 100.
  If >(profile.age, 50),:
    Let score be -(score, 20).
  If >(profile.bmi, 30),:
    Let score be -(score, 15).
  If =(profile.smoker, true),:
    Let score be -(score, 30).
  If <(profile.exerciseHours, 3),:
    Let score be -(score, 10).
  If <(score, 0),:
    Return 0.
  Return score.`,
  defaultInput: {
    profile: {
      age: 35,
      bmi: 24,
      smoker: false,
      exerciseHours: 5,
    },
  },
};

/**
 * Patient Eligibility Check
 * Simple eligibility check based on age
 */
const patientEligibilityEn: PolicyExample = {
  id: 'patient-eligibility-en',
  name: 'Patient Eligibility',
  nameZh: '患者资格审核',
  description: 'Check patient eligibility for medical services',
  descriptionZh: '检查患者医疗服务资格',
  locale: 'en-US',
  category: 'healthcare',
  source: `This module is demo.healthcare.eligibility.

Define Patient with age: Int, hasInsurance: Bool, memberYears: Int.

To checkEligibility with patient: Patient, produce Bool:
  If =(patient.hasInsurance, false),:
    Return false.
  If <(patient.age, 18),:
    Return true.
  If >=(patient.age, 65),:
    Return true.
  If >=(patient.memberYears, 1),:
    Return true.
  Return false.`,
  defaultInput: {
    patient: {
      age: 45,
      hasInsurance: true,
      memberYears: 3,
    },
  },
};

/**
 * Premium Calculator
 * Calculate insurance premium based on age and risk
 */
const premiumCalculatorEn: PolicyExample = {
  id: 'premium-calculator-en',
  name: 'Premium Calculator',
  nameZh: '保费计算器',
  description: 'Calculate insurance premium based on age and risk factors',
  descriptionZh: '根据年龄和风险因素计算保险费',
  locale: 'en-US',
  category: 'insurance',
  source: `This module is demo.insurance.premium.

Define RiskProfile with age: Int, riskScore: Int, coverageAmount: Int.

To calculatePremium with profile: RiskProfile, produce Int:
  Let basePremium be /(profile.coverageAmount, 1000).
  Let ageFactor be 100.
  If <(profile.age, 30),:
    Let ageFactor be 80.
  If >(profile.age, 50),:
    Let ageFactor be 150.
  Let riskFactor be +(100, profile.riskScore).
  Let premium be /(*(*(basePremium, ageFactor), riskFactor), 10000).
  Return premium.`,
  defaultInput: {
    profile: {
      age: 35,
      riskScore: 10,
      coverageAmount: 500000,
    },
  },
};

// ============================================
// 导出所有示例
// ============================================

export const POLICY_EXAMPLES: PolicyExample[] = [
  // 中文示例
  ageCheckZh,
  loanAmountCheckZh,
  creditScoreCheckZh,
  // 英文示例
  ageCheckEn,
  simpleLoanEn,
  ageFactorEn,
  healthScoreEn,
  patientEligibilityEn,
  premiumCalculatorEn,
];

// 按类别分组
export const POLICY_EXAMPLES_BY_CATEGORY = {
  loan: POLICY_EXAMPLES.filter((e) => e.category === 'loan'),
  insurance: POLICY_EXAMPLES.filter((e) => e.category === 'insurance'),
  healthcare: POLICY_EXAMPLES.filter((e) => e.category === 'healthcare'),
  verification: POLICY_EXAMPLES.filter((e) => e.category === 'verification'),
};

// 按语言分组
export const POLICY_EXAMPLES_BY_LOCALE = {
  'zh-CN': POLICY_EXAMPLES.filter((e) => e.locale === 'zh-CN'),
  'en-US': POLICY_EXAMPLES.filter((e) => e.locale === 'en-US'),
  'de-DE': POLICY_EXAMPLES.filter((e) => e.locale === 'de-DE'),
};

// 获取示例名称（根据 UI 语言）
export function getExampleName(example: PolicyExample, uiLocale: string): string {
  return uiLocale.startsWith('zh') ? example.nameZh : example.name;
}

// 获取示例描述（根据 UI 语言）
export function getExampleDescription(example: PolicyExample, uiLocale: string): string {
  return uiLocale.startsWith('zh') ? example.descriptionZh : example.description;
}

// 类别标签映射
export const CATEGORY_LABELS = {
  loan: { en: 'Loan', zh: '贷款' },
  insurance: { en: 'Insurance', zh: '保险' },
  healthcare: { en: 'Healthcare', zh: '医疗' },
  verification: { en: 'Verification', zh: '验证' },
};

export function getCategoryLabel(category: string, uiLocale: string): string {
  const labels = CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS];
  if (!labels) return category;
  return uiLocale.startsWith('zh') ? labels.zh : labels.en;
}

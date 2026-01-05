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
 * 贷款评估策略（简化版）
 * 演示基本的条件判断和返回值
 */
const loanEvaluationZh: PolicyExample = {
  id: 'loan-evaluation-zh',
  name: 'Loan Evaluation',
  nameZh: '贷款评估',
  description: 'Simple loan evaluation based on applicant age',
  descriptionZh: '基于申请人年龄的简单贷款评估',
  locale: 'zh-CN',
  category: 'loan',
  source: `【模块】金融.贷款评估。

【定义】贷款申请 包含 申请人编号：文本，金额：整数。

【定义】贷款决定 包含 批准：布尔，原因：文本。

检查年龄 入参 年龄：整数，产出 布尔：
  若 年龄 小于 18：
    返回 假。
  返回 真。

评估贷款 入参 申请：贷款申请，年龄：整数，产出 贷款决定：
  令 年龄合格 为 检查年龄(年龄)。
  若 非 年龄合格：
    返回 贷款决定(批准：假，原因：「申请人未满18岁」)。
  若 申请.金额 大于 100000：
    返回 贷款决定(批准：假，原因：「金额超过限额」)。
  返回 贷款决定(批准：真，原因：「审核通过」)。`,
  defaultInput: {
    申请: { 申请人编号: 'A001', 金额: 50000 },
    年龄: 25,
  },
};

/**
 * 贷款申请策略（完整版）
 * 演示复杂的业务规则：信用评分、收入验证、债务比率
 */
const loanApplicationZh: PolicyExample = {
  id: 'loan-application-zh',
  name: 'Loan Application',
  nameZh: '贷款申请',
  description: 'Complete loan application with credit score, income and debt ratio validation',
  descriptionZh: '完整贷款申请：包含信用评分、收入和债务比率验证',
  locale: 'zh-CN',
  category: 'loan',
  source: `【模块】金融.贷款申请。

【定义】申请人 包含
  编号：文本，
  姓名：文本，
  年龄：整数，
  信用评分：整数，
  年收入：整数，
  现有债务：整数。

【定义】贷款请求 包含
  金额：整数，
  期限月数：整数，
  用途：文本。

计算债务比率 入参 申请人数据：申请人，请求：贷款请求，产出 小数：
  令 月还款 为 请求.金额 除以 请求.期限月数。
  令 月收入 为 申请人数据.年收入 除以 12。
  令 现有月债务 为 申请人数据.现有债务 除以 12。
  令 总月债务 为 现有月债务 加 月还款。
  令 比率 为 总月债务 除以 月收入。
  返回 比率。

评估贷款申请 入参 申请人数据：申请人，请求：贷款请求，产出 布尔：
  若 申请人数据.年龄 小于 18：
    返回 假。
  若 申请人数据.信用评分 小于 600：
    返回 假。
  令 债务比率 为 计算债务比率(申请人数据，请求)。
  若 债务比率 大于 0.43：
    返回 假。
  返回 真。`,
  defaultInput: {
    申请人数据: {
      编号: 'A001',
      姓名: '张三',
      年龄: 30,
      信用评分: 720,
      年收入: 120000,
      现有债务: 24000,
    },
    请求: {
      金额: 50000,
      期限月数: 36,
      用途: '购车',
    },
  },
};

/**
 * 用户验证策略
 * 演示多条件验证逻辑
 */
const userVerificationZh: PolicyExample = {
  id: 'user-verification-zh',
  name: 'User Verification',
  nameZh: '用户验证',
  description: 'Multi-factor user verification',
  descriptionZh: '多因素用户验证',
  locale: 'zh-CN',
  category: 'verification',
  source: `【模块】身份.用户验证。

【定义】用户信息 包含
  邮箱：文本，
  手机号：文本，
  手机已验证：布尔，
  邮箱已验证：布尔，
  实名认证：布尔。

验证用户 入参 用户：用户信息，产出 布尔：
  若 用户.手机已验证 等于 假：
    返回 假。
  若 用户.邮箱已验证 等于 假：
    返回 假。
  若 用户.实名认证 等于 真：
    返回 真。
  返回 假。`,
  defaultInput: {
    用户: {
      邮箱: 'user@example.com',
      手机号: '13800138000',
      手机已验证: true,
      邮箱已验证: true,
      实名认证: true,
    },
  },
};

// ============================================
// 英文策略示例
// ============================================

/**
 * Auto Insurance Quote
 * Complex insurance calculation with driver and vehicle factors
 */
const autoInsuranceEn: PolicyExample = {
  id: 'auto-insurance-en',
  name: 'Auto Insurance Quote',
  nameZh: '汽车保险报价',
  description: 'Calculate auto insurance premium based on driver profile and vehicle details',
  descriptionZh: '根据驾驶员档案和车辆详情计算汽车保险费',
  locale: 'en-US',
  category: 'insurance',
  source: `This module is demo.insurance.auto.

Define Driver with age: Int, yearsLicensed: Int, accidentCount: Int, violationCount: Int, creditScore: Int.

Define Vehicle with year: Int, make: Text, model: Text, value: Int, safetyRating: Int.

To calculateAgeFactor with age: Int, produce Int:
  If <(age, 25),:
    Return 150.
  If >(age, 65),:
    Return 120.
  Return 100.

To calculateVehicleFactor with vehicle: Vehicle, produce Int:
  Let vehicleAge be -(2025, vehicle.year).
  If <(vehicleAge, 3),:
    Return 130.
  If >=(vehicle.safetyRating, 4),:
    Return 90.
  Return 100.

To calculateBasePremium with driver: Driver, vehicle: Vehicle, produce Int:
  Let baseCost be 500.
  Let ageFactor be calculateAgeFactor(driver.age).
  Let vehicleFactor be calculateVehicleFactor(vehicle).
  Let accidentPenalty be *(driver.accidentCount, 200).
  Let violationPenalty be *(driver.violationCount, 100).
  Let premium be +(+(*(baseCost, ageFactor), *(baseCost, vehicleFactor)), +(accidentPenalty, violationPenalty)).
  Return premium.`,
  defaultInput: {
    driver: {
      age: 35,
      yearsLicensed: 15,
      accidentCount: 0,
      violationCount: 1,
      creditScore: 750,
    },
    vehicle: {
      year: 2022,
      make: 'Toyota',
      model: 'Camry',
      value: 28000,
      safetyRating: 5,
    },
  },
};

/**
 * Life Insurance Quote
 * Health-based life insurance calculation
 */
const lifeInsuranceEn: PolicyExample = {
  id: 'life-insurance-en',
  name: 'Life Insurance Quote',
  nameZh: '人寿保险报价',
  description: 'Calculate life insurance premium based on applicant health profile',
  descriptionZh: '根据申请人健康档案计算人寿保险费',
  locale: 'en-US',
  category: 'insurance',
  source: `This module is demo.insurance.life.

Define Applicant with age: Int, gender: Text, smoker: Bool, bmi: Int, occupation: Text, healthScore: Int.

Define PolicyRequest with coverageAmount: Int, termYears: Int.

To calculateBaseRate with age: Int, produce Int:
  If >(age, 60),:
    Return 80.
  If >(age, 50),:
    Return 50.
  Return 30.

To calculateHealthMultiplier with applicant: Applicant, produce Int:
  Let multiplier be 100.
  If =(applicant.smoker, true),:
    Let multiplier be *(multiplier, 2).
  If >(applicant.bmi, 30),:
    Let multiplier be +(multiplier, 30).
  If <(applicant.healthScore, 70),:
    Let multiplier be +(multiplier, 20).
  Return multiplier.

To calculatePremium with applicant: Applicant, request: PolicyRequest, produce Int:
  Let baseRate be calculateBaseRate(applicant.age).
  Let healthMultiplier be calculateHealthMultiplier(applicant).
  Let annualCost be /(*(*(request.coverageAmount, baseRate), healthMultiplier), 100000).
  Let premium be /(annualCost, 12).
  Return premium.`,
  defaultInput: {
    applicant: {
      age: 40,
      gender: 'male',
      smoker: false,
      bmi: 24.5,
      occupation: 'engineer',
      healthScore: 85,
    },
    request: {
      coverageAmount: 500000,
      termYears: 20,
    },
  },
};

/**
 * Healthcare Eligibility
 * Check patient eligibility for healthcare services
 */
const healthcareEligibilityEn: PolicyExample = {
  id: 'healthcare-eligibility-en',
  name: 'Healthcare Eligibility',
  nameZh: '医疗资格审核',
  description: 'Check patient eligibility for medical services based on insurance and age',
  descriptionZh: '根据保险和年龄检查患者医疗服务资格',
  locale: 'en-US',
  category: 'healthcare',
  source: `This module is demo.healthcare.eligibility.

Define Patient with age: Int, hasInsurance: Bool, insuranceType: Text, chronicConditions: Int.

Define Service with name: Text, category: Text, requiresPreAuth: Bool, cost: Int.

To checkCoverage with patient: Patient, service: Service, produce Bool:
  If =(patient.hasInsurance, false),:
    Return false.
  If <(patient.age, 18),:
    Return true.
  If >=(patient.age, 65),:
    Return true.
  If =(patient.insuranceType, "premium"),:
    Return true.
  If =(patient.insuranceType, "basic"),:
    If =(service.category, "emergency"),:
      Return true.
    If =(service.category, "preventive"),:
      Return true.
  Return false.

To calculateCopay with patient: Patient, service: Service, produce Int:
  If =(patient.hasInsurance, false),:
    Return service.cost.
  If =(patient.insuranceType, "premium"),:
    Return /(service.cost, 10).
  If =(patient.insuranceType, "basic"),:
    Return /(*(service.cost, 3), 10).
  Return service.cost.`,
  defaultInput: {
    patient: {
      age: 45,
      hasInsurance: true,
      insuranceType: 'premium',
      chronicConditions: 1,
    },
    service: {
      name: 'Annual Physical',
      category: 'preventive',
      requiresPreAuth: false,
      cost: 500,
    },
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

// ============================================
// 导出所有示例
// ============================================

export const POLICY_EXAMPLES: PolicyExample[] = [
  // 中文示例
  loanEvaluationZh,
  loanApplicationZh,
  userVerificationZh,
  // 英文示例
  simpleLoanEn,
  autoInsuranceEn,
  lifeInsuranceEn,
  healthcareEligibilityEn,
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

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
  source: `功能 评估贷款 入参 申请：贷款申请，年龄：整数，产出 贷款决定：
  令 贷款决定 为 假
  令 年龄合格 为 假
  若 年龄 大于等于 18 则
    设置 贷款决定 为 真
  返回 贷款决定`,
  defaultInput: {
    申请: { 编号: 'A001', 金额: 50000 },
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
  source: `定义 申请人 包含
  编号：字符串，
  姓名：字符串，
  年龄：整数，
  信用评分：整数，
  年收入：整数，
  现有债务：整数。

定义 贷款请求 包含
  金额：整数，
  期限月数：整数，
  用途：字符串。

功能 计算债务比率 入参 申请人：申请人，贷款请求：贷款请求，产出 比率：小数：
  令 月还款 为 贷款请求 的 金额 除以 贷款请求 的 期限月数
  令 月收入 为 申请人 的 年收入 除以 12
  令 现有月债务 为 申请人 的 现有债务 除以 12
  令 总月债务 为 现有月债务 加 月还款
  令 比率 为 总月债务 除以 月收入
  返回 比率

功能 评估贷款申请 入参 申请人：申请人，贷款请求：贷款请求，产出 结果：布尔：
  令 结果 为 假

  若 申请人 的 年龄 小于 18 则
    返回 假

  若 申请人 的 信用评分 小于 600 则
    返回 假

  令 债务比率 为 计算债务比率（申请人，贷款请求）
  若 债务比率 大于 0.43 则
    返回 假

  设置 结果 为 真
  返回 结果`,
  defaultInput: {
    申请人: {
      编号: 'A001',
      姓名: '张三',
      年龄: 30,
      信用评分: 720,
      年收入: 120000,
      现有债务: 24000,
    },
    贷款请求: {
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
  source: `定义 用户信息 包含
  邮箱：字符串，
  手机号：字符串，
  手机已验证：布尔，
  邮箱已验证：布尔，
  实名认证：布尔。

功能 验证用户 入参 用户：用户信息，产出 验证结果：布尔：
  令 验证结果 为 假

  若 用户 的 手机已验证 等于 假 则
    返回 假

  若 用户 的 邮箱已验证 等于 假 则
    返回 假

  若 用户 的 实名认证 等于 真 则
    设置 验证结果 为 真

  返回 验证结果`,
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
  source: `Define Driver with
  age: Integer,
  yearsLicensed: Integer,
  accidentCount: Integer,
  violationCount: Integer,
  creditScore: Integer.

Define Vehicle with
  year: Integer,
  make: String,
  model: String,
  value: Integer,
  safetyRating: Integer.

Function calculateAgeFactor with driver: Driver, outputs factor: Decimal:
  Let factor be 1.0
  If driver's age less than 25 then
    Set factor to 1.5
  If driver's age greater than 65 then
    Set factor to 1.2
  Return factor

Function calculateVehicleFactor with vehicle: Vehicle, outputs factor: Decimal:
  Let factor be 1.0
  Let vehicleAge be 2024 minus vehicle's year
  If vehicleAge less than 3 then
    Set factor to 1.3
  If vehicle's safetyRating greater than or equal to 4 then
    Set factor to factor times 0.9
  Return factor

Function calculateBasePremium with driver: Driver, vehicle: Vehicle, outputs premium: Integer:
  Let baseCost be 500
  Let ageFactor be calculateAgeFactor(driver)
  Let vehicleFactor be calculateVehicleFactor(vehicle)
  Let accidentPenalty be driver's accidentCount times 200
  Let violationPenalty be driver's violationCount times 100
  Let premium be baseCost times ageFactor times vehicleFactor plus accidentPenalty plus violationPenalty
  Return premium`,
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
  source: `Define Applicant with
  age: Integer,
  gender: String,
  smoker: Boolean,
  bmi: Decimal,
  occupation: String,
  healthScore: Integer.

Define PolicyRequest with
  coverageAmount: Integer,
  termYears: Integer.

Function calculateBaseRate with applicant: Applicant, outputs rate: Decimal:
  Let rate be 0.5
  If applicant's age greater than 50 then
    Set rate to rate plus 0.3
  If applicant's age greater than 60 then
    Set rate to rate plus 0.5
  Return rate

Function calculateHealthMultiplier with applicant: Applicant, outputs multiplier: Decimal:
  Let multiplier be 1.0
  If applicant's smoker equals true then
    Set multiplier to multiplier times 2.0
  If applicant's bmi greater than 30 then
    Set multiplier to multiplier times 1.3
  If applicant's healthScore less than 70 then
    Set multiplier to multiplier times 1.2
  Return multiplier

Function calculatePremium with applicant: Applicant, request: PolicyRequest, outputs premium: Integer:
  Let baseRate be calculateBaseRate(applicant)
  Let healthMultiplier be calculateHealthMultiplier(applicant)
  Let annualCost be request's coverageAmount times baseRate times healthMultiplier divided by 1000
  Let premium be annualCost divided by 12
  Return premium`,
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
  source: `Define Patient with
  age: Integer,
  hasInsurance: Boolean,
  insuranceType: String,
  chronicConditions: Integer.

Define Service with
  name: String,
  category: String,
  requiresPreAuth: Boolean,
  cost: Integer.

Function checkCoverage with patient: Patient, service: Service, outputs covered: Boolean:
  Let covered be false

  If patient's hasInsurance equals false then
    Return false

  If patient's age less than 18 then
    Set covered to true
    Return covered

  If patient's age greater than or equal to 65 then
    Set covered to true
    Return covered

  If patient's insuranceType equals "premium" then
    Set covered to true

  If patient's insuranceType equals "basic" then
    If service's category equals "emergency" then
      Set covered to true
    If service's category equals "preventive" then
      Set covered to true

  Return covered

Function calculateCopay with patient: Patient, service: Service, outputs copay: Integer:
  Let copay be service's cost

  If patient's hasInsurance equals false then
    Return copay

  If patient's insuranceType equals "premium" then
    Set copay to service's cost times 0.1

  If patient's insuranceType equals "basic" then
    Set copay to service's cost times 0.3

  Return copay`,
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
  source: `Define LoanApplication with
  applicantId: String,
  creditScore: Integer,
  annualIncome: Integer,
  requestedAmount: Integer,
  employmentYears: Integer.

Function evaluateLoan with application: LoanApplication, outputs approved: Boolean:
  Let approved be false

  If application's creditScore less than 600 then
    Return false

  If application's annualIncome less than 30000 then
    Return false

  Let maxLoanAmount be application's annualIncome times 3
  If application's requestedAmount greater than maxLoanAmount then
    Return false

  If application's employmentYears less than 1 then
    Return false

  Set approved to true
  Return approved`,
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

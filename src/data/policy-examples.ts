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
  令 最大贷款 为 申请.年收入 乘 5。
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
// 复杂策略示例
// ============================================

/**
 * 汽车保险报价 (中文)
 * 演示多类型定义、多函数调用、复杂业务逻辑
 * 注意：结构体字段名需使用英文以符合 CNL 语法规范
 */
const autoInsuranceZh: PolicyExample = {
  id: 'auto-insurance-zh',
  name: 'Auto Insurance Quote',
  nameZh: '汽车保险报价',
  description: 'Calculate auto insurance premium with multiple risk factors',
  descriptionZh: '根据多种风险因素计算汽车保险费',
  locale: 'zh-CN',
  category: 'insurance',
  source: `【模块】保险.汽车。

【定义】Driver 包含 id: Text, age: Int, drivingYears: Int, accidents: Int, violations: Int.

【定义】Vehicle 包含 plateNo: Text, vehicleAge: Int, value: Int, safetyScore: Int.

【定义】QuoteResult 包含 approved: Bool, reason: Text, monthlyPremium: Int, deductible: Int.

计算年龄因子 入参 age: Int，产出 Int：
  若 age 小于 25：
    返回 250。
  若 age 小于 35：
    返回 150。
  若 age 小于 55：
    返回 120。
  若 age 小于 70：
    返回 140。
  返回 180。

计算风险系数 入参 driver: Driver，vehicle: Vehicle，产出 Int：
  令 factor 为 100。
  若 driver.accidents 大于 0：
    令 penalty 为 driver.accidents 乘 25。
    令 factor 为 factor 加 penalty。
  若 driver.violations 大于 0：
    令 penalty 为 driver.violations 乘 15。
    令 factor 为 factor 加 penalty。
  若 vehicle.safetyScore 大于 8：
    令 factor 为 factor 减 10。
  返回 factor。

生成报价 入参 driver: Driver，vehicle: Vehicle，产出 QuoteResult：
  若 driver.age 小于 18：
    返回 QuoteResult with approved = false, reason = "未满18岁", monthlyPremium = 0, deductible = 0.
  若 driver.accidents 大于 3：
    返回 QuoteResult with approved = false, reason = "事故次数过多", monthlyPremium = 0, deductible = 0.
  令 ageFactor 为 计算年龄因子(driver.age)。
  令 vehicleFactor 为 100。
  若 vehicle.vehicleAge 大于 10：
    令 vehicleFactor 为 80。
  令 basePremium 为 ageFactor 加 vehicleFactor。
  令 riskFactor 为 计算风险系数(driver，vehicle)。
  令 finalPremium 为 basePremium 乘 riskFactor。
  令 ded 为 1000。
  若 driver.drivingYears 大于 5：
    令 ded 为 500。
  返回 QuoteResult with approved = true, reason = "报价成功", monthlyPremium = finalPremium, deductible = ded.`,
  defaultInput: {
    driver: {
      id: 'D001',
      age: 35,
      drivingYears: 10,
      accidents: 1,
      violations: 2,
    },
    vehicle: {
      plateNo: '京A12345',
      vehicleAge: 3,
      value: 200000,
      safetyScore: 9,
    },
  },
};

/**
 * 医疗理赔审核 (中文)
 * 演示复杂业务规则和多条件判断
 * 注意：结构体字段名需使用英文以符合 CNL 语法规范
 */
const medicalClaimZh: PolicyExample = {
  id: 'medical-claim-zh',
  name: 'Medical Claim Processing',
  nameZh: '医疗理赔审核',
  description: 'Process medical insurance claims with network and limit checks',
  descriptionZh: '处理医疗保险理赔，包含网络内外和限额检查',
  locale: 'zh-CN',
  category: 'healthcare',
  source: `【模块】医疗.理赔。

【定义】Claim 包含 claimId: Text, patientId: Text, amount: Int, diagnosisCode: Text.

【定义】Provider 包含 providerId: Text, inNetwork: Bool, specialty: Text, qualityScore: Int.

【定义】ClaimResult 包含 approved: Bool, reason: Text, payoutAmount: Int, needsReview: Bool.

计算赔付比例 入参 amount: Int，coverageRate: Int，specialty: Text，产出 Int：
  令 basePayout 为 amount 乘 coverageRate。
  若 specialty 等于 "specialty"：
    令 adjustedRate 为 coverageRate 减 10。
    返回 amount 乘 adjustedRate。
  若 specialty 等于 "surgery"：
    令 adjustedRate 为 coverageRate 加 5。
    返回 amount 乘 adjustedRate。
  返回 basePayout。

处理理赔 入参 claim: Claim，provider: Provider，coverageRate: Int，产出 ClaimResult：
  若 非 provider.inNetwork：
    返回 ClaimResult with approved = false, reason = "医疗机构不在网络内", payoutAmount = 0, needsReview = false.
  若 claim.amount 大于 50000：
    返回 ClaimResult with approved = false, reason = "金额超过限额", payoutAmount = 0, needsReview = true.
  若 provider.qualityScore 小于 70：
    返回 ClaimResult with approved = false, reason = "机构质量评分不足", payoutAmount = 0, needsReview = true.
  令 payout 为 计算赔付比例(claim.amount，coverageRate，provider.specialty)。
  若 payout 等于 0：
    返回 ClaimResult with approved = false, reason = "覆盖范围排除", payoutAmount = 0, needsReview = false.
  返回 ClaimResult with approved = true, reason = "理赔批准", payoutAmount = payout, needsReview = false.`,
  defaultInput: {
    claim: {
      claimId: 'C001',
      patientId: 'P001',
      amount: 15000,
      diagnosisCode: 'D001',
    },
    provider: {
      providerId: 'H001',
      inNetwork: true,
      specialty: 'surgery',
      qualityScore: 92,
    },
    coverageRate: 80,
  },
};

/**
 * Life Insurance Underwriting (English)
 * Complex example with multiple helper functions and struct returns
 */
const lifeInsuranceEn: PolicyExample = {
  id: 'life-insurance-en',
  name: 'Life Insurance Underwriting',
  nameZh: '人寿保险核保',
  description: 'Comprehensive life insurance quote with health and occupation factors',
  descriptionZh: '综合人寿保险报价，考虑健康和职业因素',
  locale: 'en-US',
  category: 'insurance',
  source: `This module is insurance.life.

Define Applicant with applicantId: Text, age: Int, smoker: Bool, bmi: Int, occupation: Text, healthScore: Int.

Define PolicyRequest with coverageAmount: Int, termYears: Int.

Define LifeQuote with approved: Bool, reason: Text, monthlyPremium: Int, coverageAmount: Int.

To calculateBaseRate with age: Int, termYears: Int, produce Int:
  If <(age, 30),:
    If >(termYears, 20),:
      Return 50.
    Return 40.
  If <(age, 45),:
    If >(termYears, 20),:
      Return 75.
    Return 60.
  If <(age, 60),:
    Return 95.
  Return 150.

To calculateHealthMultiplier with applicant: Applicant, produce Int:
  Let multiplier be 100.
  If applicant.smoker,:
    Let multiplier be +(multiplier, 100).
  If >(applicant.bmi, 30),:
    Let multiplier be +(multiplier, 40).
  If >(applicant.bmi, 35),:
    Let multiplier be +(multiplier, 30).
  If <(applicant.healthScore, 60),:
    Let multiplier be +(multiplier, 50).
  If >(applicant.healthScore, 85),:
    Let multiplier be -(multiplier, 20).
  Return multiplier.

To calculateOccupationMultiplier with occupation: Text, produce Int:
  If =(occupation, "HighRisk"),:
    Return 150.
  If =(occupation, "ModerateRisk"),:
    Return 120.
  If =(occupation, "Office"),:
    Return 90.
  Return 100.

To generateLifeQuote with applicant: Applicant, request: PolicyRequest, produce LifeQuote:
  If <(applicant.age, 18),:
    Return LifeQuote with approved = false, reason = "Age below 18", monthlyPremium = 0, coverageAmount = 0.
  If >(applicant.age, 75),:
    Return LifeQuote with approved = false, reason = "Age above 75", monthlyPremium = 0, coverageAmount = 0.
  If <(applicant.healthScore, 40),:
    Return LifeQuote with approved = false, reason = "Health score too low", monthlyPremium = 0, coverageAmount = 0.
  If >(request.coverageAmount, 5000000),:
    Return LifeQuote with approved = false, reason = "Coverage exceeds maximum", monthlyPremium = 0, coverageAmount = 0.
  Let baseRate be calculateBaseRate(applicant.age, request.termYears).
  Let healthMult be calculateHealthMultiplier(applicant).
  Let occMult be calculateOccupationMultiplier(applicant.occupation).
  Let combinedMult be *(healthMult, occMult).
  Let monthlyPrem be *(baseRate, combinedMult).
  Return LifeQuote with approved = true, reason = "Quote approved", monthlyPremium = monthlyPrem, coverageAmount = request.coverageAmount.`,
  defaultInput: {
    applicant: {
      applicantId: 'A001',
      age: 35,
      smoker: false,
      bmi: 24,
      occupation: 'Office',
      healthScore: 85,
    },
    request: {
      coverageAmount: 1000000,
      termYears: 20,
    },
  },
};

/**
 * Order Fulfillment Eligibility (English)
 * E-commerce order validation with inventory and shipping rules
 */
const orderFulfillmentEn: PolicyExample = {
  id: 'order-fulfillment-en',
  name: 'Order Fulfillment Check',
  nameZh: '订单履行检查',
  description: 'Validate order eligibility based on inventory and customer status',
  descriptionZh: '基于库存和客户状态验证订单资格',
  locale: 'en-US',
  category: 'verification',
  source: `This module is ecommerce.fulfillment.

Define OrderItem with sku: Text, quantity: Int, unitPrice: Int.

Define Customer with customerId: Text, memberTier: Text, accountAge: Int, orderCount: Int.

Define FulfillmentResult with canFulfill: Bool, reason: Text, shippingTier: Text, estimatedDays: Int.

To calculateShippingTier with customer: Customer, orderTotal: Int, produce Text:
  If =(customer.memberTier, "Premium"),:
    Return "Express".
  If =(customer.memberTier, "Gold"),:
    If >(orderTotal, 10000),:
      Return "Express".
    Return "Standard".
  If >(orderTotal, 20000),:
    Return "Standard".
  Return "Economy".

To calculateEstimatedDays with shippingTier: Text, produce Int:
  If =(shippingTier, "Express"),:
    Return 2.
  If =(shippingTier, "Standard"),:
    Return 5.
  Return 10.

To checkFulfillment with item: OrderItem, customer: Customer, stockLevel: Int, produce FulfillmentResult:
  If <(stockLevel, item.quantity),:
    Return FulfillmentResult with canFulfill = false, reason = "Insufficient stock", shippingTier = "None", estimatedDays = 0.
  If <(customer.accountAge, 7),:
    If >(item.quantity, 5),:
      Return FulfillmentResult with canFulfill = false, reason = "New account order limit", shippingTier = "None", estimatedDays = 0.
  Let orderTotal be *(item.quantity, item.unitPrice).
  If >(orderTotal, 100000),:
    If <(customer.orderCount, 10),:
      Return FulfillmentResult with canFulfill = false, reason = "High value order requires history", shippingTier = "None", estimatedDays = 0.
  Let tier be calculateShippingTier(customer, orderTotal).
  Let days be calculateEstimatedDays(tier).
  Return FulfillmentResult with canFulfill = true, reason = "Order approved", shippingTier = tier, estimatedDays = days.`,
  defaultInput: {
    item: {
      sku: 'SKU-12345',
      quantity: 3,
      unitPrice: 5000,
    },
    customer: {
      customerId: 'C001',
      memberTier: 'Gold',
      accountAge: 365,
      orderCount: 25,
    },
    stockLevel: 50,
  },
};

/**
 * 贷款综合评估 (中文)
 * 完整的贷款审批流程，包含多项检查
 * 注意：结构体字段名需使用英文以符合 CNL 语法规范
 */
const loanEvaluationZh: PolicyExample = {
  id: 'loan-evaluation-zh',
  name: 'Comprehensive Loan Evaluation',
  nameZh: '贷款综合评估',
  description: 'Full loan approval process with multiple validation steps',
  descriptionZh: '完整的贷款审批流程，包含多项验证步骤',
  locale: 'zh-CN',
  category: 'loan',
  source: `【模块】金融.贷款评估。

【定义】Applicant 包含 id: Text, age: Int, income: Int, creditScore: Int, workYears: Int, debtRatio: Int.

【定义】LoanRequest 包含 amount: Int, termMonths: Int, purpose: Text.

【定义】ApprovalResult 包含 approved: Bool, reason: Text, interestRate: Int, monthlyPayment: Int.

检查基础资格 入参 applicant: Applicant，产出 Bool：
  若 applicant.age 小于 22：
    返回 false。
  若 applicant.age 大于 60：
    返回 false。
  若 applicant.workYears 小于 1：
    返回 false。
  返回 true。

计算信用等级 入参 creditScore: Int，产出 Int：
  若 creditScore 小于 550：
    返回 0。
  若 creditScore 小于 650：
    返回 1。
  若 creditScore 小于 750：
    返回 2。
  返回 3。

计算利率 入参 creditLevel: Int，termMonths: Int，产出 Int：
  令 baseRate 为 500。
  若 creditLevel 等于 3：
    令 baseRate 为 baseRate 减 100。
  若 creditLevel 等于 1：
    令 baseRate 为 baseRate 加 150。
  若 creditLevel 等于 0：
    返回 0。
  若 termMonths 大于 36：
    令 baseRate 为 baseRate 加 50。
  返回 baseRate。

评估贷款 入参 applicant: Applicant，request: LoanRequest，产出 ApprovalResult：
  令 qualified 为 检查基础资格(applicant)。
  若 非 qualified：
    返回 ApprovalResult with approved = false, reason = "基础资格不符", interestRate = 0, monthlyPayment = 0.
  若 applicant.debtRatio 大于 60：
    返回 ApprovalResult with approved = false, reason = "负债率过高", interestRate = 0, monthlyPayment = 0.
  令 maxAmount 为 applicant.income 乘 applicant.workYears。
  若 request.amount 大于 maxAmount：
    返回 ApprovalResult with approved = false, reason = "申请金额超过可贷额度", interestRate = 0, monthlyPayment = 0.
  令 creditLevel 为 计算信用等级(applicant.creditScore)。
  若 creditLevel 等于 0：
    返回 ApprovalResult with approved = false, reason = "信用评分不足", interestRate = 0, monthlyPayment = 0.
  令 annualRate 为 计算利率(creditLevel，request.termMonths)。
  令 monthly 为 request.amount 除 request.termMonths。
  返回 ApprovalResult with approved = true, reason = "审批通过", interestRate = annualRate, monthlyPayment = monthly.`,
  defaultInput: {
    applicant: {
      id: 'APP-001',
      age: 35,
      income: 20000,
      creditScore: 720,
      workYears: 8,
      debtRatio: 30,
    },
    request: {
      amount: 100000,
      termMonths: 24,
      purpose: '装修',
    },
  },
};

// ============================================
// 更多复杂中文示例
// ============================================

/**
 * 员工绩效评估 (中文)
 * 演示 Text 操作和复杂计算逻辑
 * 注意：结构体字段名需使用英文以符合 CNL 语法规范
 */
const employeePerformanceZh: PolicyExample = {
  id: 'employee-performance-zh',
  name: 'Employee Performance Evaluation',
  nameZh: '员工绩效评估',
  description: 'Evaluate employee performance with multiple metrics and text processing',
  descriptionZh: '基于多项指标和文本处理的员工绩效评估',
  locale: 'zh-CN',
  category: 'verification',
  source: `【模块】人事.绩效。

【定义】Employee 包含 empId: Text, name: Text, department: Text, yearsEmployed: Int, level: Text.

【定义】PerformanceData 包含 salesAmount: Int, customerCount: Int, complaints: Int, attendanceRate: Int, trainingHours: Int.

【定义】EvalResult 包含 passed: Bool, grade: Text, bonusMultiplier: Int, suggestion: Text.

计算基础分 入参 data: PerformanceData，产出 Int：
  令 score 为 0。
  若 data.salesAmount 大于 100000：
    令 score 为 score 加 30。
  若 data.salesAmount 大于 50000：
    令 score 为 score 加 20。
  若 data.customerCount 大于 20：
    令 score 为 score 加 20。
  若 data.attendanceRate 大于 95：
    令 score 为 score 加 15。
  若 data.trainingHours 大于 40：
    令 score 为 score 加 15。
  返回 score。

计算扣分 入参 data: PerformanceData，产出 Int：
  令 deduction 为 0。
  若 data.complaints 大于 0：
    令 deduction 为 data.complaints 乘 5。
  若 data.attendanceRate 小于 90：
    令 deduction 为 deduction 加 10。
  返回 deduction。

确定等级 入参 totalScore: Int，产出 Text：
  若 totalScore 大于 85：
    返回 "优秀"。
  若 totalScore 大于 70：
    返回 "良好"。
  若 totalScore 大于 60：
    返回 "合格"。
  返回 "待改进"。

评估绩效 入参 emp: Employee，data: PerformanceData，产出 EvalResult：
  令 baseScore 为 计算基础分(data)。
  令 deduction 为 计算扣分(data)。
  令 totalScore 为 baseScore 减 deduction。
  若 totalScore 小于 0：
    令 totalScore 为 0。
  令 grade 为 确定等级(totalScore)。
  令 passed 为 totalScore 大于 60。
  令 bonus 为 100。
  若 grade 等于 "优秀"：
    令 bonus 为 150。
  若 grade 等于 "良好"：
    令 bonus 为 120。
  若 grade 等于 "待改进"：
    令 bonus 为 80。
  令 suggestion 为 "继续保持"。
  若 data.complaints 大于 2：
    令 suggestion 为 "需改善服务态度"。
  若 data.trainingHours 小于 20：
    令 suggestion 为 "建议增加培训"。
  返回 EvalResult with passed = passed, grade = grade, bonusMultiplier = bonus, suggestion = suggestion.`,
  defaultInput: {
    emp: {
      empId: 'EMP001',
      name: '张三',
      department: '销售部',
      yearsEmployed: 3,
      level: '高级',
    },
    data: {
      salesAmount: 120000,
      customerCount: 25,
      complaints: 1,
      attendanceRate: 98,
      trainingHours: 45,
    },
  },
};

/**
 * KYC合规审核 (中文)
 * 演示复杂的身份验证和合规检查逻辑
 * 注意：结构体字段名需使用英文以符合 CNL 语法规范
 */
const kycComplianceZh: PolicyExample = {
  id: 'kyc-compliance-zh',
  name: 'KYC Compliance Check',
  nameZh: 'KYC合规审核',
  description: 'Know Your Customer compliance verification with multiple validation rules',
  descriptionZh: '客户身份识别合规验证，包含多项验证规则',
  locale: 'zh-CN',
  category: 'verification',
  source: `【模块】合规.身份验证。

【定义】CustomerInfo 包含 name: Text, idNumber: Text, age: Int, nationality: Text, occupation: Text, annualIncome: Int.

【定义】TransactionRequest 包含 txnType: Text, amount: Int, purpose: Text.

【定义】KycResult 包含 passed: Bool, riskLevel: Text, reason: Text, needsManualReview: Bool.

验证证件格式 入参 idNumber: Text，产出 Bool：
  令 len 为 Text.length(idNumber)。
  若 len 等于 18：
    返回 true。
  若 len 等于 15：
    返回 true。
  返回 false。

计算风险分数 入参 customer: CustomerInfo，txn: TransactionRequest，产出 Int：
  令 riskScore 为 0。
  若 customer.annualIncome 小于 50000：
    若 txn.amount 大于 100000：
      令 riskScore 为 riskScore 加 30。
  若 txn.amount 大于 500000：
    令 riskScore 为 riskScore 加 20。
  若 txn.txnType 等于 "cross-border"：
    令 riskScore 为 riskScore 加 15。
  若 customer.age 小于 22：
    若 txn.amount 大于 50000：
      令 riskScore 为 riskScore 加 10。
  返回 riskScore。

确定风险等级 入参 riskScore: Int，产出 Text：
  若 riskScore 大于 50：
    返回 "高风险"。
  若 riskScore 大于 25：
    返回 "中风险"。
  返回 "低风险"。

执行KYC审核 入参 customer: CustomerInfo，txn: TransactionRequest，产出 KycResult：
  令 idValid 为 验证证件格式(customer.idNumber)。
  若 非 idValid：
    返回 KycResult with passed = false, riskLevel = "未评估", reason = "证件格式无效", needsManualReview = false.
  若 customer.age 小于 18：
    返回 KycResult with passed = false, riskLevel = "未评估", reason = "未成年人不允许交易", needsManualReview = false.
  令 riskScore 为 计算风险分数(customer，txn)。
  令 riskLevel 为 确定风险等级(riskScore)。
  若 riskLevel 等于 "高风险"：
    返回 KycResult with passed = false, riskLevel = riskLevel, reason = "风险评估未通过", needsManualReview = true.
  若 riskLevel 等于 "中风险"：
    若 txn.amount 大于 200000：
      返回 KycResult with passed = false, riskLevel = riskLevel, reason = "中风险大额交易需复核", needsManualReview = true.
  返回 KycResult with passed = true, riskLevel = riskLevel, reason = "审核通过", needsManualReview = false.`,
  defaultInput: {
    customer: {
      name: '李四',
      idNumber: '110101199001011234',
      age: 34,
      nationality: '中国',
      occupation: '工程师',
      annualIncome: 200000,
    },
    txn: {
      txnType: 'domestic',
      amount: 50000,
      purpose: '购房首付',
    },
  },
};

/**
 * 产品定价策略 (中文)
 * 演示 Text 操作和动态定价逻辑
 * 注意：结构体字段名需使用英文以符合 CNL 语法规范
 */
const productPricingZh: PolicyExample = {
  id: 'product-pricing-zh',
  name: 'Product Pricing Strategy',
  nameZh: '产品定价策略',
  description: 'Dynamic pricing based on customer segment and product category',
  descriptionZh: '基于客户分层和产品类别的动态定价',
  locale: 'zh-CN',
  category: 'verification',
  source: `【模块】销售.定价。

【定义】Product 包含 code: Text, name: Text, category: Text, originalPrice: Int, stock: Int.

【定义】Customer 包含 id: Text, tier: Text, totalSpent: Int, memberDays: Int.

【定义】PricingResult 包含 finalPrice: Int, discountRate: Int, description: Text, canPurchase: Bool.

计算会员折扣 入参 tier: Text，产出 Int：
  若 tier 等于 "钻石"：
    返回 70。
  若 tier 等于 "金卡"：
    返回 80。
  若 tier 等于 "银卡"：
    返回 90。
  返回 100。

计算忠诚度加成 入参 days: Int，spent: Int，产出 Int：
  令 bonus 为 0。
  若 days 大于 365：
    令 bonus 为 bonus 加 3。
  若 spent 大于 10000：
    令 bonus 为 bonus 加 2。
  若 spent 大于 50000：
    令 bonus 为 bonus 加 3。
  返回 bonus。

检查类别前缀 入参 category: Text，产出 Bool：
  返回 Text.startsWith(category，"电子")。

计算定价 入参 product: Product，customer: Customer，产出 PricingResult：
  若 product.stock 小于 1：
    返回 PricingResult with finalPrice = 0, discountRate = 0, description = "商品缺货", canPurchase = false.
  令 memberDiscount 为 计算会员折扣(customer.tier)。
  令 loyaltyBonus 为 计算忠诚度加成(customer.memberDays，customer.totalSpent)。
  令 finalDiscount 为 memberDiscount 减 loyaltyBonus。
  若 finalDiscount 小于 60：
    令 finalDiscount 为 60。
  令 isElectronics 为 检查类别前缀(product.category)。
  若 isElectronics：
    若 finalDiscount 小于 85：
      令 finalDiscount 为 85。
  令 finalPrice 为 product.originalPrice 乘 finalDiscount。
  令 finalPrice 为 finalPrice 除 100。
  令 desc 为 Text.concat(customer.tier，"会员专享价")。
  返回 PricingResult with finalPrice = finalPrice, discountRate = finalDiscount, description = desc, canPurchase = true.`,
  defaultInput: {
    product: {
      code: 'P001',
      name: '无线耳机',
      category: '电子产品',
      originalPrice: 500,
      stock: 100,
    },
    customer: {
      id: 'C001',
      tier: '金卡',
      totalSpent: 30000,
      memberDays: 500,
    },
  },
};

/**
 * 物流配送评估 (中文)
 * 演示复杂的配送规则和费用计算
 * 注意：结构体字段名需使用英文以符合 CNL 语法规范
 */
const logisticsEvaluationZh: PolicyExample = {
  id: 'logistics-evaluation-zh',
  name: 'Logistics Delivery Evaluation',
  nameZh: '物流配送评估',
  description: 'Evaluate delivery options based on weight, distance and urgency',
  descriptionZh: '基于重量、距离和紧急程度评估配送方案',
  locale: 'zh-CN',
  category: 'verification',
  source: `【模块】物流.配送。

【定义】Package 包含 id: Text, weight: Int, volume: Int, fragile: Bool, declaredValue: Int.

【定义】Address 包含 province: Text, city: Text, district: Text, isRemote: Bool.

【定义】DeliveryOption 包含 serviceType: Text, urgent: Bool, insured: Bool.

【定义】DeliveryPlan 包含 canDeliver: Bool, estimatedDays: Int, shippingFee: Int, insuranceFee: Int, totalCost: Int, notes: Text.

计算基础运费 入参 weight: Int，volume: Int，产出 Int：
  令 weightFee 为 weight 乘 2。
  令 volumeFee 为 volume 除 1000。
  若 weightFee 大于 volumeFee：
    返回 weightFee。
  返回 volumeFee。

计算配送时间 入参 addr: Address，urgent: Bool，产出 Int：
  令 baseDays 为 3。
  若 addr.isRemote：
    令 baseDays 为 baseDays 加 2。
  若 urgent：
    令 baseDays 为 baseDays 减 1。
  若 baseDays 小于 1：
    返回 1。
  返回 baseDays。

计算保价费 入参 declaredValue: Int，insured: Bool，产出 Int：
  若 非 insured：
    返回 0。
  令 fee 为 declaredValue 乘 3。
  令 fee 为 fee 除 1000。
  若 fee 小于 10：
    返回 10。
  返回 fee。

评估配送 入参 pkg: Package，addr: Address，option: DeliveryOption，产出 DeliveryPlan：
  若 pkg.weight 大于 50000：
    返回 DeliveryPlan with canDeliver = false, estimatedDays = 0, shippingFee = 0, insuranceFee = 0, totalCost = 0, notes = "超重无法配送".
  若 pkg.fragile：
    若 addr.isRemote：
      返回 DeliveryPlan with canDeliver = false, estimatedDays = 0, shippingFee = 0, insuranceFee = 0, totalCost = 0, notes = "易碎品不支持偏远地区".
  令 baseFee 为 计算基础运费(pkg.weight，pkg.volume)。
  若 option.urgent：
    令 baseFee 为 baseFee 乘 150。
    令 baseFee 为 baseFee 除 100。
  若 addr.isRemote：
    令 baseFee 为 baseFee 加 20。
  若 pkg.fragile：
    令 baseFee 为 baseFee 加 15。
  令 insFee 为 计算保价费(pkg.declaredValue，option.insured)。
  令 days 为 计算配送时间(addr，option.urgent)。
  令 total 为 baseFee 加 insFee。
  令 note 为 Text.concat(option.serviceType，"配送")。
  返回 DeliveryPlan with canDeliver = true, estimatedDays = days, shippingFee = baseFee, insuranceFee = insFee, totalCost = total, notes = note.`,
  defaultInput: {
    pkg: {
      id: 'PKG001',
      weight: 2500,
      volume: 30000,
      fragile: false,
      declaredValue: 1000,
    },
    addr: {
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      isRemote: false,
    },
    option: {
      serviceType: '标准',
      urgent: false,
      insured: true,
    },
  },
};

// ============================================
// 更多复杂英文示例
// ============================================

/**
 * Fraud Detection Engine (English)
 * Complex fraud scoring with multiple risk indicators
 */
const fraudDetectionEn: PolicyExample = {
  id: 'fraud-detection-en',
  name: 'Fraud Detection Engine',
  nameZh: '欺诈检测引擎',
  description: 'Comprehensive fraud detection with multiple risk indicators and scoring',
  descriptionZh: '包含多项风险指标和评分的综合欺诈检测',
  locale: 'en-US',
  category: 'verification',
  source: `This module is security.fraud.

Define Transaction with transactionId: Text, amount: Int, merchantType: Text, isOnline: Bool, hourOfDay: Int.

Define UserProfile with userId: Text, accountAge: Int, avgTransaction: Int, totalTransactions: Int, flaggedCount: Int.

Define DeviceInfo with deviceId: Text, isNewDevice: Bool, vpnDetected: Bool, locationMismatch: Bool.

Define FraudResult with blocked: Bool, riskScore: Int, riskLevel: Text, reason: Text, requiresReview: Bool.

To calculateAmountRisk with transaction: Transaction, profile: UserProfile, produce Int:
  Let risk be 0.
  If >(transaction.amount, *(profile.avgTransaction, 5)),:
    Let risk be +(risk, 30).
  If >(transaction.amount, *(profile.avgTransaction, 3)),:
    Let risk be +(risk, 15).
  If >(transaction.amount, 10000),:
    Let risk be +(risk, 10).
  Return risk.

To calculateTimeRisk with hourOfDay: Int, produce Int:
  If <(hourOfDay, 6),:
    Return 15.
  If >(hourOfDay, 23),:
    Return 15.
  Return 0.

To calculateDeviceRisk with device: DeviceInfo, produce Int:
  Let risk be 0.
  If device.isNewDevice,:
    Let risk be +(risk, 20).
  If device.vpnDetected,:
    Let risk be +(risk, 25).
  If device.locationMismatch,:
    Let risk be +(risk, 30).
  Return risk.

To calculateProfileRisk with profile: UserProfile, produce Int:
  Let risk be 0.
  If <(profile.accountAge, 30),:
    Let risk be +(risk, 20).
  If <(profile.totalTransactions, 5),:
    Let risk be +(risk, 15).
  If >(profile.flaggedCount, 0),:
    Let risk be +(risk, *(profile.flaggedCount, 10)).
  Return risk.

To determineRiskLevel with score: Int, produce Text:
  If >(score, 70),:
    Return "Critical".
  If >(score, 50),:
    Return "High".
  If >(score, 30),:
    Return "Medium".
  Return "Low".

To detectFraud with transaction: Transaction, profile: UserProfile, device: DeviceInfo, produce FraudResult:
  Let amountRisk be calculateAmountRisk(transaction, profile).
  Let timeRisk be calculateTimeRisk(transaction.hourOfDay).
  Let deviceRisk be calculateDeviceRisk(device).
  Let profileRisk be calculateProfileRisk(profile).
  Let totalScore be +(+(+(amountRisk, timeRisk), deviceRisk), profileRisk).
  If >(totalScore, 100),:
    Let totalScore be 100.
  Let riskLevel be determineRiskLevel(totalScore).
  If =(riskLevel, "Critical"),:
    Return FraudResult with blocked = true, riskScore = totalScore, riskLevel = riskLevel, reason = "Critical risk level detected", requiresReview = true.
  If =(riskLevel, "High"),:
    If transaction.isOnline,:
      Return FraudResult with blocked = true, riskScore = totalScore, riskLevel = riskLevel, reason = "High risk online transaction", requiresReview = true.
    Return FraudResult with blocked = false, riskScore = totalScore, riskLevel = riskLevel, reason = "High risk requires monitoring", requiresReview = true.
  Return FraudResult with blocked = false, riskScore = totalScore, riskLevel = riskLevel, reason = "Transaction approved", requiresReview = false.`,
  defaultInput: {
    transaction: {
      transactionId: 'TXN001',
      amount: 2500,
      merchantType: 'Electronics',
      isOnline: true,
      hourOfDay: 14,
    },
    profile: {
      userId: 'U001',
      accountAge: 365,
      avgTransaction: 500,
      totalTransactions: 50,
      flaggedCount: 0,
    },
    device: {
      deviceId: 'D001',
      isNewDevice: false,
      vpnDetected: false,
      locationMismatch: false,
    },
  },
};

/**
 * Subscription Billing Engine (English)
 * Complex subscription pricing with proration and discounts
 */
const subscriptionBillingEn: PolicyExample = {
  id: 'subscription-billing-en',
  name: 'Subscription Billing Engine',
  nameZh: '订阅计费引擎',
  description: 'Calculate subscription charges with proration, upgrades and discounts',
  descriptionZh: '计算订阅费用，包含按比例计费、升级和折扣',
  locale: 'en-US',
  category: 'verification',
  source: `This module is billing.subscription.

Define Plan with planId: Text, name: Text, monthlyPrice: Int, annualPrice: Int, features: Int.

Define Subscription with subscriptionId: Text, currentPlan: Text, billingCycle: Text, daysRemaining: Int, isActive: Bool.

Define UpgradeRequest with newPlan: Text, applyImmediately: Bool, useCredit: Bool.

Define BillingResult with approved: Bool, chargeAmount: Int, creditAmount: Int, newMonthlyRate: Int, effectiveDate: Text, notes: Text.

To getPlanPrice with planName: Text, isAnnual: Bool, produce Int:
  If =(planName, "Enterprise"),:
    If isAnnual,:
      Return 9990.
    Return 999.
  If =(planName, "Professional"),:
    If isAnnual,:
      Return 4990.
    Return 499.
  If =(planName, "Starter"),:
    If isAnnual,:
      Return 990.
    Return 99.
  Return 0.

To calculateProration with currentPrice: Int, newPrice: Int, daysRemaining: Int, produce Int:
  Let dailyCurrent be /(currentPrice, 30).
  Let dailyNew be /(newPrice, 30).
  Let difference be -(dailyNew, dailyCurrent).
  Let prorated be *(difference, daysRemaining).
  If <(prorated, 0),:
    Return 0.
  Return prorated.

To calculateDiscount with isAnnual: Bool, isUpgrade: Bool, produce Int:
  Let discount be 0.
  If isAnnual,:
    Let discount be +(discount, 17).
  If isUpgrade,:
    Let discount be +(discount, 10).
  Return discount.

To processBilling with subscription: Subscription, request: UpgradeRequest, produce BillingResult:
  If =(subscription.isActive, false),:
    Return BillingResult with approved = false, chargeAmount = 0, creditAmount = 0, newMonthlyRate = 0, effectiveDate = "N/A", notes = "Subscription is not active".
  Let isAnnual be =(subscription.billingCycle, "Annual").
  Let currentPrice be getPlanPrice(subscription.currentPlan, isAnnual).
  Let newPrice be getPlanPrice(request.newPlan, isAnnual).
  If <=(newPrice, currentPrice),:
    Return BillingResult with approved = false, chargeAmount = 0, creditAmount = 0, newMonthlyRate = 0, effectiveDate = "N/A", notes = "Cannot downgrade through this process".
  Let prorated be calculateProration(currentPrice, newPrice, subscription.daysRemaining).
  Let discountPct be calculateDiscount(isAnnual, true).
  Let discountAmount be /(*(prorated, discountPct), 100).
  Let finalCharge be -(prorated, discountAmount).
  Let creditAmount be 0.
  If request.useCredit,:
    If >(subscription.daysRemaining, 15),:
      Let creditAmount be /(*(currentPrice, subscription.daysRemaining), 30).
      Let finalCharge be -(finalCharge, creditAmount).
  If <(finalCharge, 0),:
    Let finalCharge be 0.
  Let effectiveDate be "Immediate".
  If =(request.applyImmediately, false),:
    Let effectiveDate be "Next billing cycle".
    Let finalCharge be 0.
  Return BillingResult with approved = true, chargeAmount = finalCharge, creditAmount = creditAmount, newMonthlyRate = newPrice, effectiveDate = effectiveDate, notes = "Upgrade processed successfully".`,
  defaultInput: {
    subscription: {
      subscriptionId: 'SUB001',
      currentPlan: 'Starter',
      billingCycle: 'Monthly',
      daysRemaining: 20,
      isActive: true,
    },
    request: {
      newPlan: 'Professional',
      applyImmediately: true,
      useCredit: true,
    },
  },
};

/**
 * Warranty Claim Processor (English)
 * Complex warranty validation with coverage checks
 */
const warrantyClaimEn: PolicyExample = {
  id: 'warranty-claim-en',
  name: 'Warranty Claim Processor',
  nameZh: '保修索赔处理',
  description: 'Process warranty claims with coverage validation and repair authorization',
  descriptionZh: '处理保修索赔，包含覆盖范围验证和维修授权',
  locale: 'en-US',
  category: 'verification',
  source: `This module is service.warranty.

Define Product with productId: Text, category: Text, purchasePrice: Int, purchaseDate: Int, warrantyMonths: Int.

Define Claim with claimId: Text, issueType: Text, description: Text, estimatedRepairCost: Int, currentDate: Int.

Define ClaimResult with approved: Bool, coverageType: Text, authorizedAmount: Int, customerCopay: Int, resolution: Text.

To calculateWarrantyRemaining with purchaseDate: Int, warrantyMonths: Int, currentDate: Int, produce Int:
  Let warrantyDays be *(warrantyMonths, 30).
  Let elapsedDays be -(currentDate, purchaseDate).
  Let remaining be -(warrantyDays, elapsedDays).
  If <(remaining, 0),:
    Return 0.
  Return remaining.

To determineCoverageType with issueType: Text, daysRemaining: Int, produce Text:
  If =(daysRemaining, 0),:
    Return "Expired".
  If =(issueType, "Manufacturing Defect"),:
    Return "Full Coverage".
  If =(issueType, "Normal Wear"),:
    If >(daysRemaining, 180),:
      Return "Partial Coverage".
    Return "Not Covered".
  If =(issueType, "Accidental Damage"),:
    Return "Not Covered".
  Return "Review Required".

To calculateAuthorizedAmount with coverage: Text, repairCost: Int, purchasePrice: Int, produce Int:
  If =(coverage, "Full Coverage"),:
    If >(repairCost, purchasePrice),:
      Return purchasePrice.
    Return repairCost.
  If =(coverage, "Partial Coverage"),:
    Let covered be /(*(repairCost, 50), 100).
    Return covered.
  Return 0.

To processClaim with product: Product, claim: Claim, produce ClaimResult:
  Let daysRemaining be calculateWarrantyRemaining(product.purchaseDate, product.warrantyMonths, claim.currentDate).
  Let coverage be determineCoverageType(claim.issueType, daysRemaining).
  If =(coverage, "Expired"),:
    Return ClaimResult with approved = false, coverageType = coverage, authorizedAmount = 0, customerCopay = claim.estimatedRepairCost, resolution = "Warranty has expired".
  If =(coverage, "Not Covered"),:
    Return ClaimResult with approved = false, coverageType = coverage, authorizedAmount = 0, customerCopay = claim.estimatedRepairCost, resolution = "Issue type not covered by warranty".
  If =(coverage, "Review Required"),:
    Return ClaimResult with approved = false, coverageType = coverage, authorizedAmount = 0, customerCopay = 0, resolution = "Claim requires manual review".
  Let authorized be calculateAuthorizedAmount(coverage, claim.estimatedRepairCost, product.purchasePrice).
  Let copay be -(claim.estimatedRepairCost, authorized).
  If <(copay, 0),:
    Let copay be 0.
  Let resolution be "Claim approved for repair".
  If >(authorized, /(*(product.purchasePrice, 80), 100)),:
    Let resolution be "Approved for replacement".
  Return ClaimResult with approved = true, coverageType = coverage, authorizedAmount = authorized, customerCopay = copay, resolution = resolution.`,
  defaultInput: {
    product: {
      productId: 'PROD001',
      category: 'Electronics',
      purchasePrice: 1200,
      purchaseDate: 0,
      warrantyMonths: 24,
    },
    claim: {
      claimId: 'CLM001',
      issueType: 'Manufacturing Defect',
      description: 'Screen flickering issue',
      estimatedRepairCost: 350,
      currentDate: 180,
    },
  },
};

// ============================================
// 导出所有示例
// ============================================

export const POLICY_EXAMPLES: PolicyExample[] = [
  // 中文示例 - 简单
  ageCheckZh,
  loanAmountCheckZh,
  creditScoreCheckZh,
  // 中文示例 - 复杂
  autoInsuranceZh,
  medicalClaimZh,
  loanEvaluationZh,
  employeePerformanceZh,
  kycComplianceZh,
  productPricingZh,
  logisticsEvaluationZh,
  // 英文示例 - 简单
  ageCheckEn,
  simpleLoanEn,
  ageFactorEn,
  healthScoreEn,
  patientEligibilityEn,
  premiumCalculatorEn,
  // 英文示例 - 复杂
  lifeInsuranceEn,
  orderFulfillmentEn,
  fraudDetectionEn,
  subscriptionBillingEn,
  warrantyClaimEn,
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

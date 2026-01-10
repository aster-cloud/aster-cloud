/**
 * 策略示例数据
 *
 * 基于 Policy API 集成测试用例，按领域分组
 * 每个示例包含：CNL 源代码、默认输入数据、分组路径
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
  category: PolicyCategory;
  groupPath: string[]; // 分组路径，如 ['金融', '贷款']
  source: string;
  defaultInput: PolicyExampleInput;
}

export type PolicyCategory = 'loan' | 'creditcard' | 'fraud' | 'healthcare' | 'auto-insurance';

// ============================================
// 分组定义
// ============================================

export interface PolicyGroupDef {
  id: string;
  name: string;
  nameZh: string;
  icon: string;
  children?: PolicyGroupDef[];
}

export const POLICY_GROUP_TREE: PolicyGroupDef[] = [
  {
    id: 'finance',
    name: 'Finance',
    nameZh: '金融',
    icon: 'banknote',
    children: [
      { id: 'loan', name: 'Loan', nameZh: '贷款', icon: 'landmark' },
      { id: 'creditcard', name: 'Credit Card', nameZh: '信用卡', icon: 'credit-card' },
      { id: 'fraud', name: 'Fraud Detection', nameZh: '欺诈检测', icon: 'shield-alert' },
    ],
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    nameZh: '医疗',
    icon: 'heart-pulse',
    children: [
      { id: 'eligibility', name: 'Eligibility', nameZh: '资格审核', icon: 'clipboard-check' },
    ],
  },
  {
    id: 'insurance',
    name: 'Insurance',
    nameZh: '保险',
    icon: 'shield',
    children: [
      { id: 'auto', name: 'Auto Insurance', nameZh: '汽车保险', icon: 'car' },
    ],
  },
];

// ============================================
// 策略源码
// ============================================

const LOAN_POLICY_SOURCE = `This module is aster.finance.loan.

Define LoanApplication with @NotEmpty applicantId: Text, amount: Int, @Range(min: 0, max: 600) termMonths: Int, @NotEmpty purpose: Text.

Define ApplicantProfile with @Range(min: 0, max: 120) age: Int, @Range(min: 300, max: 850) creditScore: Int, annualIncome: Int, monthlyDebt: Int, @Range(min: 0, max: 50) yearsEmployed: Int.

Define LoanDecision with approved: Bool, @NotEmpty reason: Text, approvedAmount: Int, @Range(min: 0, max: 5000) interestRateBps: Int, @Range(min: 0, max: 600) termMonths: Int.

To evaluateLoanEligibility with application: LoanApplication, applicant: ApplicantProfile, produce LoanDecision:
  If <(applicant.age, 18),:
    Return LoanDecision with approved = false, reason = "Age below 18", approvedAmount = 0, interestRateBps = 0, termMonths = 0.
  If >(applicant.age, 75),:
    Return LoanDecision with approved = false, reason = "Age above 75", approvedAmount = 0, interestRateBps = 0, termMonths = 0.
  If <(applicant.creditScore, 650),:
    Return LoanDecision with approved = false, reason = "Credit below 650", approvedAmount = 0, interestRateBps = 0, termMonths = 0.
  Let rate be determineInterestRateBps(applicant.creditScore).
  Return LoanDecision with approved = true, reason = "Approved", approvedAmount = application.amount, interestRateBps = rate, termMonths = application.termMonths.

To determineInterestRateBps with @Range(min: 300, max: 850) creditScore: Int, produce Int:
  If <(creditScore, 670),:
    Return 675.
  If <(creditScore, 740),:
    Return 550.
  If <(creditScore, 800),:
    Return 425.
  Return 350.`;

const HEALTHCARE_ELIGIBILITY_SOURCE = `This module is aster.healthcare.eligibility.

Define Patient with patientId: Text, age: Int, hasInsurance: Bool, insuranceType: Text, chronicConditions: Int.

Define Service with serviceCode: Text, serviceName: Text, basePrice: Int, requiresPreAuth: Bool.

Define EligibilityCheck with eligible: Bool, reason: Text, coveragePercent: Int, estimatedCost: Int, requiresPreAuth: Bool.

To checkServiceEligibility with patient: Patient, service: Service, produce EligibilityCheck:
  If not(patient.hasInsurance),:
    Return EligibilityCheck with eligible = false, reason = "No insurance coverage", coveragePercent = 0, estimatedCost = service.basePrice, requiresPreAuth = false.
  If <(patient.age, 18),:
    Let coverage be determineMinorCoverage(patient.insuranceType, service).
    Return EligibilityCheck with eligible = true, reason = "Minor coverage", coveragePercent = coverage, estimatedCost = calculatePatientCost(service.basePrice, coverage), requiresPreAuth = service.requiresPreAuth.
  If >(patient.age, 65),:
    Let coverage be determineSeniorCoverage(patient.insuranceType, service).
    Return EligibilityCheck with eligible = true, reason = "Senior coverage", coveragePercent = coverage, estimatedCost = calculatePatientCost(service.basePrice, coverage), requiresPreAuth = service.requiresPreAuth.
  Let coverage be determineStandardCoverage(patient.insuranceType, service, patient.chronicConditions).
  Return EligibilityCheck with eligible = true, reason = "Standard coverage", coveragePercent = coverage, estimatedCost = calculatePatientCost(service.basePrice, coverage), requiresPreAuth = service.requiresPreAuth.

To determineMinorCoverage with insuranceType: Text, service: Service, produce Int:
  If =(insuranceType, "Premium"),:
    Return 90.
  If =(insuranceType, "Standard"),:
    Return 80.
  Return 70.

To determineSeniorCoverage with insuranceType: Text, service: Service, produce Int:
  If =(insuranceType, "Medicare"),:
    Return 85.
  If =(insuranceType, "Premium"),:
    Return 95.
  If =(insuranceType, "Standard"),:
    Return 75.
  Return 60.

To determineStandardCoverage with insuranceType: Text, service: Service, chronicConditions: Int, produce Int:
  If =(insuranceType, "Premium"),:
    If >(chronicConditions, 2),:
      Return 90.
    Return 85.
  If =(insuranceType, "Standard"),:
    If >(chronicConditions, 2),:
      Return 75.
    Return 70.
  If =(insuranceType, "Basic"),:
    Return 60.
  Return 50.

To calculatePatientCost with basePrice: Int, coveragePercent: Int, produce Int:
  Let coverageAmount be *(basePrice, coveragePercent).
  Let patientPercent be -(100, coveragePercent).
  Let patientCost be *(basePrice, patientPercent).
  Return patientCost.`;

const AUTO_INSURANCE_SOURCE = `This module is aster.insurance.auto.

Define Driver with driverId: Text, age: Int, yearsLicensed: Int, accidentCount: Int, violationCount: Int, creditScore: Int.

Define Vehicle with vin: Text, year: Int, make: Text, model: Text, value: Int, safetyRating: Int.

Define PolicyQuote with approved: Bool, reason: Text, monthlyPremium: Int, deductible: Int, coverageLimit: Int.

To generateAutoQuote with driver: Driver, vehicle: Vehicle, coverageType: Text, produce PolicyQuote:
  If <(driver.age, 18),:
    Return PolicyQuote with approved = false, reason = "Driver under 18", monthlyPremium = 0, deductible = 0, coverageLimit = 0.
  If >(driver.accidentCount, 3),:
    Return PolicyQuote with approved = false, reason = "Too many accidents", monthlyPremium = 0, deductible = 0, coverageLimit = 0.
  If >(driver.violationCount, 5),:
    Return PolicyQuote with approved = false, reason = "Too many violations", monthlyPremium = 0, deductible = 0, coverageLimit = 0.
  Let basePremium be calculateBasePremium(driver, vehicle).
  Let riskMultiplier be calculateRiskMultiplier(driver, vehicle).
  Let finalPremium be *(basePremium, riskMultiplier).
  Let deductibleAmt be determineDeductible(coverageType, driver.creditScore).
  Let coverageAmt be determineCoverageLimit(coverageType, vehicle.value).
  Return PolicyQuote with approved = true, reason = "Quote approved", monthlyPremium = finalPremium, deductible = deductibleAmt, coverageLimit = coverageAmt.

To calculateBasePremium with driver: Driver, vehicle: Vehicle, produce Int:
  Let ageFactor be calculateAgeFactor(driver.age).
  Let vehicleFactor be calculateVehicleFactor(vehicle).
  Return +(ageFactor, vehicleFactor).

To calculateAgeFactor with age: Int, produce Int:
  If <(age, 25),:
    Return 250.
  If <(age, 35),:
    Return 150.
  If <(age, 55),:
    Return 120.
  If <(age, 70),:
    Return 140.
  Return 180.

To calculateVehicleFactor with vehicle: Vehicle, produce Int:
  Let currentYear be 2025.
  Let vehicleAge be -(currentYear, vehicle.year).
  If >(vehicleAge, 10),:
    Return 80.
  If >(vehicleAge, 5),:
    Return 100.
  Return 120.

To calculateRiskMultiplier with driver: Driver, vehicle: Vehicle, produce Int:
  Let baseMultiplier be 100.
  If >(driver.accidentCount, 0),:
    Let penalty be *(driver.accidentCount, 25).
    Let baseMultiplier be +(baseMultiplier, penalty).
  If >(driver.violationCount, 0),:
    Let penalty be *(driver.violationCount, 15).
    Let baseMultiplier be +(baseMultiplier, penalty).
  If <(driver.creditScore, 650),:
    Let baseMultiplier be +(baseMultiplier, 30).
  If >(vehicle.safetyRating, 8),:
    Let baseMultiplier be -(baseMultiplier, 10).
  Return baseMultiplier.

To determineDeductible with coverageType: Text, creditScore: Int, produce Int:
  If =(coverageType, "Premium"),:
    If >(creditScore, 750),:
      Return 250.
    Return 500.
  If =(coverageType, "Standard"),:
    If >(creditScore, 700),:
      Return 500.
    Return 1000.
  Return 2000.

To determineCoverageLimit with coverageType: Text, vehicleValue: Int, produce Int:
  If =(coverageType, "Premium"),:
    Return 500000.
  If =(coverageType, "Standard"),:
    Return 250000.
  If >(vehicleValue, 30000),:
    Return 100000.
  Return 50000.`;

const FRAUD_DETECTION_SOURCE = `This module is aster.finance.fraud.

Define Transaction with transactionId: Text, accountId: Text, amount: Int, timestamp: Int.

Define AccountHistory with accountId: Text, averageAmount: Int, suspiciousCount: Int, accountAge: Int, lastTimestamp: Int.

Define FraudResult with isSuspicious: Bool, riskScore: Int, reason: Text.

To detectFraud with transaction: Transaction, history: AccountHistory, produce FraudResult:
  If >(transaction.amount, 1000000),:
    Return FraudResult with isSuspicious = true, riskScore = 100, reason = "Extremely large transaction".
  If >(history.suspiciousCount, 5),:
    Return FraudResult with isSuspicious = true, riskScore = 85, reason = "High suspicious activity history".
  If <(history.accountAge, 30),:
    Return FraudResult with isSuspicious = true, riskScore = 70, reason = "New account risk".
  Return FraudResult with isSuspicious = false, riskScore = 10, reason = "Normal transaction".`;

const CREDITCARD_SOURCE = `This module is aster.finance.creditcard.

Define ApplicantInfo with applicantId: Text, age: Int, annualIncome: Int, creditScore: Int, existingCreditCards: Int, monthlyRent: Int, employmentStatus: Text, yearsAtCurrentJob: Int.

Define FinancialHistory with bankruptcyCount: Int, latePayments: Int, utilization: Int, accountAge: Int, hardInquiries: Int.

Define CreditCardOffer with productType: Text, requestedLimit: Int, hasRewards: Bool, annualFee: Int.

Define ApprovalDecision with approved: Bool, reason: Text, approvedLimit: Int, interestRateAPR: Int, monthlyFee: Int, creditLine: Int, requiresDeposit: Bool, depositAmount: Int.

To evaluateCreditCardApplication with applicant: ApplicantInfo, history: FinancialHistory, offer: CreditCardOffer, produce ApprovalDecision:
  If !=(history.bankruptcyCount, 0),:
    Return ApprovalDecision with approved = false, reason = "Bankruptcy on record", approvedLimit = 0, interestRateAPR = 0, monthlyFee = 0, creditLine = 0, requiresDeposit = false, depositAmount = 0.
  If <(applicant.age, 21),:
    Return ApprovalDecision with approved = false, reason = "Age below 21", approvedLimit = 0, interestRateAPR = 0, monthlyFee = 0, creditLine = 0, requiresDeposit = false, depositAmount = 0.
  If <(applicant.creditScore, 550),:
    Return ApprovalDecision with approved = false, reason = "Credit score too low", approvedLimit = 0, interestRateAPR = 0, monthlyFee = 0, creditLine = 0, requiresDeposit = false, depositAmount = 0.
  Return ApprovalDecision with approved = true, reason = "Approved", approvedLimit = offer.requestedLimit, interestRateAPR = 1899, monthlyFee = 0, creditLine = offer.requestedLimit, requiresDeposit = false, depositAmount = 0.`;

// ============================================
// 贷款示例
// ============================================

const loanApproved: PolicyExample = {
  id: 'loan-approved',
  name: 'Loan Application - Approved',
  nameZh: '贷款申请 - 通过',
  description: 'Loan application with good credit score and stable employment',
  descriptionZh: '信用评分良好、就业稳定的贷款申请',
  locale: 'en-US',
  category: 'loan',
  groupPath: ['Finance', 'Loan'],
  source: LOAN_POLICY_SOURCE,
  defaultInput: {
    application: {
      applicantId: 'APP-001',
      amount: 50000,
      termMonths: 36,
      purpose: 'Home improvement',
    },
    applicant: {
      age: 35,
      creditScore: 750,
      annualIncome: 80000,
      monthlyDebt: 1500,
      yearsEmployed: 8,
    },
  },
};

const loanRejectedCredit: PolicyExample = {
  id: 'loan-rejected-credit',
  name: 'Loan Application - Rejected (Low Credit)',
  nameZh: '贷款申请 - 拒绝（信用不足）',
  description: 'Loan application rejected due to low credit score',
  descriptionZh: '因信用评分过低被拒绝的贷款申请',
  locale: 'en-US',
  category: 'loan',
  groupPath: ['Finance', 'Loan'],
  source: LOAN_POLICY_SOURCE,
  defaultInput: {
    application: {
      applicantId: 'APP-002',
      amount: 30000,
      termMonths: 24,
      purpose: 'Debt consolidation',
    },
    applicant: {
      age: 28,
      creditScore: 580,
      annualIncome: 45000,
      monthlyDebt: 800,
      yearsEmployed: 3,
    },
  },
};

const loanRejectedAge: PolicyExample = {
  id: 'loan-rejected-age',
  name: 'Loan Application - Rejected (Age Limit)',
  nameZh: '贷款申请 - 拒绝（年龄限制）',
  description: 'Loan application rejected due to age above limit',
  descriptionZh: '因年龄超过限制被拒绝的贷款申请',
  locale: 'en-US',
  category: 'loan',
  groupPath: ['Finance', 'Loan'],
  source: LOAN_POLICY_SOURCE,
  defaultInput: {
    application: {
      applicantId: 'APP-003',
      amount: 20000,
      termMonths: 12,
      purpose: 'Medical expenses',
    },
    applicant: {
      age: 78,
      creditScore: 720,
      annualIncome: 60000,
      monthlyDebt: 500,
      yearsEmployed: 40,
    },
  },
};

// ============================================
// 医疗资格示例
// ============================================

const healthcareEligibleSenior: PolicyExample = {
  id: 'healthcare-eligible-senior',
  name: 'Healthcare Eligibility - Senior Patient',
  nameZh: '医疗资格 - 老年患者',
  description: 'Eligibility check for a senior patient with Medicare',
  descriptionZh: '持有Medicare的老年患者资格审核',
  locale: 'en-US',
  category: 'healthcare',
  groupPath: ['Healthcare', 'Eligibility'],
  source: HEALTHCARE_ELIGIBILITY_SOURCE,
  defaultInput: {
    patient: {
      patientId: 'PAT-001',
      age: 70,
      hasInsurance: true,
      insuranceType: 'Medicare',
      chronicConditions: 2,
    },
    service: {
      serviceCode: 'SVC-001',
      serviceName: 'Annual checkup',
      basePrice: 500,
      requiresPreAuth: false,
    },
  },
};

const healthcareNoInsurance: PolicyExample = {
  id: 'healthcare-no-insurance',
  name: 'Healthcare Eligibility - No Insurance',
  nameZh: '医疗资格 - 无保险',
  description: 'Eligibility check for patient without insurance',
  descriptionZh: '无保险患者的资格审核',
  locale: 'en-US',
  category: 'healthcare',
  groupPath: ['Healthcare', 'Eligibility'],
  source: HEALTHCARE_ELIGIBILITY_SOURCE,
  defaultInput: {
    patient: {
      patientId: 'PAT-002',
      age: 45,
      hasInsurance: false,
      insuranceType: '',
      chronicConditions: 0,
    },
    service: {
      serviceCode: 'SVC-002',
      serviceName: 'X-Ray',
      basePrice: 300,
      requiresPreAuth: false,
    },
  },
};

const healthcareEligibleMinor: PolicyExample = {
  id: 'healthcare-eligible-minor',
  name: 'Healthcare Eligibility - Minor Patient',
  nameZh: '医疗资格 - 未成年患者',
  description: 'Eligibility check for a minor patient with Standard insurance',
  descriptionZh: '持有标准保险的未成年患者资格审核',
  locale: 'en-US',
  category: 'healthcare',
  groupPath: ['Healthcare', 'Eligibility'],
  source: HEALTHCARE_ELIGIBILITY_SOURCE,
  defaultInput: {
    patient: {
      patientId: 'PAT-003',
      age: 12,
      hasInsurance: true,
      insuranceType: 'Standard',
      chronicConditions: 0,
    },
    service: {
      serviceCode: 'SVC-003',
      serviceName: 'Vaccination',
      basePrice: 150,
      requiresPreAuth: false,
    },
  },
};

// ============================================
// 汽车保险示例
// ============================================

const autoInsuranceApproved: PolicyExample = {
  id: 'auto-insurance-approved',
  name: 'Auto Insurance Quote - Approved',
  nameZh: '汽车保险报价 - 通过',
  description: 'Auto insurance quote for experienced driver with clean record',
  descriptionZh: '驾驶记录良好的老司机汽车保险报价',
  locale: 'en-US',
  category: 'auto-insurance',
  groupPath: ['Insurance', 'Auto Insurance'],
  source: AUTO_INSURANCE_SOURCE,
  defaultInput: {
    driver: {
      driverId: 'DRV-001',
      age: 35,
      yearsLicensed: 15,
      accidentCount: 0,
      violationCount: 1,
      creditScore: 720,
    },
    vehicle: {
      vin: '1HGBH41JXMN109186',
      year: 2022,
      make: 'Honda',
      model: 'Accord',
      value: 28000,
      safetyRating: 9,
    },
    coverageType: 'Standard',
  },
};

const autoInsuranceRejectedAge: PolicyExample = {
  id: 'auto-insurance-rejected-age',
  name: 'Auto Insurance Quote - Rejected (Underage)',
  nameZh: '汽车保险报价 - 拒绝（未成年）',
  description: 'Auto insurance quote rejected for underage driver',
  descriptionZh: '未成年驾驶员的汽车保险报价被拒绝',
  locale: 'en-US',
  category: 'auto-insurance',
  groupPath: ['Insurance', 'Auto Insurance'],
  source: AUTO_INSURANCE_SOURCE,
  defaultInput: {
    driver: {
      driverId: 'DRV-002',
      age: 16,
      yearsLicensed: 0,
      accidentCount: 0,
      violationCount: 0,
      creditScore: 0,
    },
    vehicle: {
      vin: '2HGBH41JXMN109187',
      year: 2020,
      make: 'Toyota',
      model: 'Camry',
      value: 25000,
      safetyRating: 8,
    },
    coverageType: 'Basic',
  },
};

const autoInsuranceRejectedAccidents: PolicyExample = {
  id: 'auto-insurance-rejected-accidents',
  name: 'Auto Insurance Quote - Rejected (Too Many Accidents)',
  nameZh: '汽车保险报价 - 拒绝（事故过多）',
  description: 'Auto insurance quote rejected due to accident history',
  descriptionZh: '因事故记录过多被拒绝的汽车保险报价',
  locale: 'en-US',
  category: 'auto-insurance',
  groupPath: ['Insurance', 'Auto Insurance'],
  source: AUTO_INSURANCE_SOURCE,
  defaultInput: {
    driver: {
      driverId: 'DRV-003',
      age: 45,
      yearsLicensed: 25,
      accidentCount: 5,
      violationCount: 3,
      creditScore: 680,
    },
    vehicle: {
      vin: '3HGBH41JXMN109188',
      year: 2019,
      make: 'BMW',
      model: '3 Series',
      value: 35000,
      safetyRating: 7,
    },
    coverageType: 'Premium',
  },
};

// ============================================
// 欺诈检测示例
// ============================================

const fraudNormal: PolicyExample = {
  id: 'fraud-normal',
  name: 'Fraud Detection - Normal Transaction',
  nameZh: '欺诈检测 - 正常交易',
  description: 'Normal transaction from established account',
  descriptionZh: '来自老账户的正常交易',
  locale: 'en-US',
  category: 'fraud',
  groupPath: ['Finance', 'Fraud Detection'],
  source: FRAUD_DETECTION_SOURCE,
  defaultInput: {
    transaction: {
      transactionId: 'TXN-001',
      accountId: 'ACC-001',
      amount: 500,
      timestamp: 1704067200,
    },
    history: {
      accountId: 'ACC-001',
      averageAmount: 450,
      suspiciousCount: 0,
      accountAge: 365,
      lastTimestamp: 1704060000,
    },
  },
};

const fraudSuspiciousLarge: PolicyExample = {
  id: 'fraud-suspicious-large',
  name: 'Fraud Detection - Large Transaction Alert',
  nameZh: '欺诈检测 - 大额交易预警',
  description: 'Suspicious transaction flagged due to large amount',
  descriptionZh: '因金额过大被标记的可疑交易',
  locale: 'en-US',
  category: 'fraud',
  groupPath: ['Finance', 'Fraud Detection'],
  source: FRAUD_DETECTION_SOURCE,
  defaultInput: {
    transaction: {
      transactionId: 'TXN-002',
      accountId: 'ACC-002',
      amount: 1500000,
      timestamp: 1704067200,
    },
    history: {
      accountId: 'ACC-002',
      averageAmount: 1000,
      suspiciousCount: 0,
      accountAge: 180,
      lastTimestamp: 1704060000,
    },
  },
};

const fraudSuspiciousNewAccount: PolicyExample = {
  id: 'fraud-suspicious-new-account',
  name: 'Fraud Detection - New Account Risk',
  nameZh: '欺诈检测 - 新账户风险',
  description: 'Transaction flagged due to new account risk',
  descriptionZh: '因新账户风险被标记的交易',
  locale: 'en-US',
  category: 'fraud',
  groupPath: ['Finance', 'Fraud Detection'],
  source: FRAUD_DETECTION_SOURCE,
  defaultInput: {
    transaction: {
      transactionId: 'TXN-003',
      accountId: 'ACC-003',
      amount: 2000,
      timestamp: 1704067200,
    },
    history: {
      accountId: 'ACC-003',
      averageAmount: 0,
      suspiciousCount: 0,
      accountAge: 7,
      lastTimestamp: 1704060000,
    },
  },
};

// ============================================
// 信用卡示例
// ============================================

const creditcardApproved: PolicyExample = {
  id: 'creditcard-approved',
  name: 'Credit Card Application - Approved',
  nameZh: '信用卡申请 - 通过',
  description: 'Credit card application with good credit history',
  descriptionZh: '信用记录良好的信用卡申请',
  locale: 'en-US',
  category: 'creditcard',
  groupPath: ['Finance', 'Credit Card'],
  source: CREDITCARD_SOURCE,
  defaultInput: {
    applicant: {
      applicantId: 'CCA-001',
      age: 32,
      annualIncome: 85000,
      creditScore: 740,
      existingCreditCards: 2,
      monthlyRent: 1500,
      employmentStatus: 'Full-time',
      yearsAtCurrentJob: 5,
    },
    history: {
      bankruptcyCount: 0,
      latePayments: 1,
      utilization: 25,
      accountAge: 8,
      hardInquiries: 2,
    },
    offer: {
      productType: 'Standard',
      requestedLimit: 10000,
      hasRewards: true,
      annualFee: 0,
    },
  },
};

const creditcardRejectedAge: PolicyExample = {
  id: 'creditcard-rejected-age',
  name: 'Credit Card Application - Rejected (Underage)',
  nameZh: '信用卡申请 - 拒绝（年龄不足）',
  description: 'Credit card application rejected due to age below 21',
  descriptionZh: '因年龄未满21岁被拒绝的信用卡申请',
  locale: 'en-US',
  category: 'creditcard',
  groupPath: ['Finance', 'Credit Card'],
  source: CREDITCARD_SOURCE,
  defaultInput: {
    applicant: {
      applicantId: 'CCA-002',
      age: 19,
      annualIncome: 25000,
      creditScore: 680,
      existingCreditCards: 0,
      monthlyRent: 800,
      employmentStatus: 'Part-time',
      yearsAtCurrentJob: 1,
    },
    history: {
      bankruptcyCount: 0,
      latePayments: 0,
      utilization: 0,
      accountAge: 1,
      hardInquiries: 1,
    },
    offer: {
      productType: 'Standard',
      requestedLimit: 5000,
      hasRewards: false,
      annualFee: 0,
    },
  },
};

const creditcardRejectedBankruptcy: PolicyExample = {
  id: 'creditcard-rejected-bankruptcy',
  name: 'Credit Card Application - Rejected (Bankruptcy)',
  nameZh: '信用卡申请 - 拒绝（破产记录）',
  description: 'Credit card application rejected due to bankruptcy on record',
  descriptionZh: '因存在破产记录被拒绝的信用卡申请',
  locale: 'en-US',
  category: 'creditcard',
  groupPath: ['Finance', 'Credit Card'],
  source: CREDITCARD_SOURCE,
  defaultInput: {
    applicant: {
      applicantId: 'CCA-003',
      age: 45,
      annualIncome: 65000,
      creditScore: 550,
      existingCreditCards: 0,
      monthlyRent: 1200,
      employmentStatus: 'Full-time',
      yearsAtCurrentJob: 3,
    },
    history: {
      bankruptcyCount: 1,
      latePayments: 5,
      utilization: 80,
      accountAge: 2,
      hardInquiries: 4,
    },
    offer: {
      productType: 'Standard',
      requestedLimit: 3000,
      hasRewards: false,
      annualFee: 0,
    },
  },
};

// ============================================
// 导出所有示例
// ============================================

export const POLICY_EXAMPLES: PolicyExample[] = [
  // 贷款
  loanApproved,
  loanRejectedCredit,
  loanRejectedAge,
  // 医疗
  healthcareEligibleSenior,
  healthcareNoInsurance,
  healthcareEligibleMinor,
  // 汽车保险
  autoInsuranceApproved,
  autoInsuranceRejectedAge,
  autoInsuranceRejectedAccidents,
  // 欺诈检测
  fraudNormal,
  fraudSuspiciousLarge,
  fraudSuspiciousNewAccount,
  // 信用卡
  creditcardApproved,
  creditcardRejectedAge,
  creditcardRejectedBankruptcy,
];

// 按类别分组
export const POLICY_EXAMPLES_BY_CATEGORY = {
  loan: POLICY_EXAMPLES.filter((e) => e.category === 'loan'),
  creditcard: POLICY_EXAMPLES.filter((e) => e.category === 'creditcard'),
  fraud: POLICY_EXAMPLES.filter((e) => e.category === 'fraud'),
  healthcare: POLICY_EXAMPLES.filter((e) => e.category === 'healthcare'),
  'auto-insurance': POLICY_EXAMPLES.filter((e) => e.category === 'auto-insurance'),
};

// 按语言分组
export const POLICY_EXAMPLES_BY_LOCALE = {
  'zh-CN': POLICY_EXAMPLES.filter((e) => e.locale === 'zh-CN'),
  'en-US': POLICY_EXAMPLES.filter((e) => e.locale === 'en-US'),
  'de-DE': POLICY_EXAMPLES.filter((e) => e.locale === 'de-DE'),
};

// 按分组路径分组
export function getExamplesByGroupPath(groupPath: string[]): PolicyExample[] {
  return POLICY_EXAMPLES.filter((e) => {
    if (e.groupPath.length < groupPath.length) return false;
    return groupPath.every((segment, i) => e.groupPath[i] === segment);
  });
}

// 获取示例名称（根据 UI 语言）
export function getExampleName(example: PolicyExample, uiLocale: string): string {
  return uiLocale.startsWith('zh') ? example.nameZh : example.name;
}

// 获取示例描述（根据 UI 语言）
export function getExampleDescription(example: PolicyExample, uiLocale: string): string {
  return uiLocale.startsWith('zh') ? example.descriptionZh : example.description;
}

// 类别标签映射
export const CATEGORY_LABELS: Record<PolicyCategory, { en: string; zh: string }> = {
  loan: { en: 'Loan', zh: '贷款' },
  creditcard: { en: 'Credit Card', zh: '信用卡' },
  fraud: { en: 'Fraud Detection', zh: '欺诈检测' },
  healthcare: { en: 'Healthcare', zh: '医疗' },
  'auto-insurance': { en: 'Auto Insurance', zh: '汽车保险' },
};

export function getCategoryLabel(category: string, uiLocale: string): string {
  const labels = CATEGORY_LABELS[category as PolicyCategory];
  if (!labels) return category;
  return uiLocale.startsWith('zh') ? labels.zh : labels.en;
}

// 获取分组名称（根据 UI 语言）
export function getGroupName(group: PolicyGroupDef, uiLocale: string): string {
  return uiLocale.startsWith('zh') ? group.nameZh : group.name;
}

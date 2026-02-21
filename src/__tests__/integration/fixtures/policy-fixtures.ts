/**
 * 集成测试固定数据
 *
 * 用于调用真实 Policy API 的测试数据定义
 */

// ============================================
// 类型定义
// ============================================

export interface TestCase<TContext, TExpected> {
  context: TContext;
  expected: TExpected;
}

export interface PolicyFixture<TContext = Record<string, unknown>, TExpected = unknown> {
  source: string;
  locale: 'en-US' | 'zh-CN' | 'de-DE';
  functionName: string;
  testCases: Record<string, TestCase<TContext, TExpected>>;
}

// ============================================
// 贷款领域 - aster.finance.loan
// ============================================

export const LOAN_POLICY = {
  source: `Module aster.finance.loan.

Define LoanApplication has applicantId: Text, amount: Int, termMonths: Int, purpose: Text.

Define ApplicantProfile has age: Int, creditScore: Int, annualIncome: Int, monthlyDebt: Int, yearsEmployed: Int.

Define LoanDecision has approved: Bool, reason: Text, approvedAmount: Int, interestRateBps: Int, termMonths: Int.

Rule evaluateLoanEligibility given application: LoanApplication, applicant: ApplicantProfile:
  If <(applicant.age, 18),:
    Return LoanDecision with approved = false, reason = "Age below 18", approvedAmount = 0, interestRateBps = 0, termMonths = 0.
  If >(applicant.age, 75),:
    Return LoanDecision with approved = false, reason = "Age above 75", approvedAmount = 0, interestRateBps = 0, termMonths = 0.
  If <(applicant.creditScore, 650),:
    Return LoanDecision with approved = false, reason = "Credit below 650", approvedAmount = 0, interestRateBps = 0, termMonths = 0.
  Let rate be determineInterestRateBps(applicant.creditScore).
  Return LoanDecision with approved = true, reason = "Approved", approvedAmount = application.amount, interestRateBps = rate, termMonths = application.termMonths.

Rule determineInterestRateBps given creditScore: Int:
  If <(creditScore, 670),:
    Return 675.
  If <(creditScore, 740),:
    Return 550.
  If <(creditScore, 800),:
    Return 425.
  Return 350.
`,
  locale: 'en-US',
  functionName: 'evaluateLoanEligibility',
  testCases: {
    // 优质申请人 - 批准
    approved: {
      context: {
        application: {
          applicantId: 'APP-001',
          amount: 50000,
          termMonths: 36,
          purpose: 'Home improvement',
        },
        applicant: {
          age: 35,
          creditScore: 780,
          annualIncome: 120000,
          monthlyDebt: 2000,
          yearsEmployed: 10,
        },
      },
      expected: {
        approved: true,
        reason: 'Approved',
        approvedAmount: 50000,
        termMonths: 36,
      },
    },
    // 年龄过小 - 拒绝
    rejectedByAge: {
      context: {
        application: {
          applicantId: 'APP-002',
          amount: 10000,
          termMonths: 12,
          purpose: 'Education',
        },
        applicant: {
          age: 17,
          creditScore: 700,
          annualIncome: 30000,
          monthlyDebt: 500,
          yearsEmployed: 1,
        },
      },
      expected: {
        approved: false,
        reason: 'Age below 18',
      },
    },
    // 信用评分过低 - 拒绝
    rejectedByCredit: {
      context: {
        application: {
          applicantId: 'APP-003',
          amount: 25000,
          termMonths: 24,
          purpose: 'Car purchase',
        },
        applicant: {
          age: 30,
          creditScore: 580,
          annualIncome: 60000,
          monthlyDebt: 1500,
          yearsEmployed: 5,
        },
      },
      expected: {
        approved: false,
        reason: 'Credit below 650',
      },
    },
    // 年龄过大 - 拒绝 (>75)
    rejectedByAgeOver75: {
      context: {
        application: {
          applicantId: 'APP-004',
          amount: 20000,
          termMonths: 12,
          purpose: 'Medical expenses',
        },
        applicant: {
          age: 78,
          creditScore: 750,
          annualIncome: 50000,
          monthlyDebt: 500,
          yearsEmployed: 40,
        },
      },
      expected: {
        approved: false,
        reason: 'Age above 75',
      },
    },
    // 边界信用评分 - 最低档利率 (650-670 → 675 bps)
    approvedLowestTier: {
      context: {
        application: {
          applicantId: 'APP-005',
          amount: 15000,
          termMonths: 24,
          purpose: 'Debt consolidation',
        },
        applicant: {
          age: 40,
          creditScore: 655,
          annualIncome: 70000,
          monthlyDebt: 1000,
          yearsEmployed: 8,
        },
      },
      expected: {
        approved: true,
        reason: 'Approved',
        approvedAmount: 15000,
        termMonths: 24,
        interestRateBps: 675,
      },
    },
    // 中档利率 (670-740 → 550 bps)
    approvedMidTier: {
      context: {
        application: {
          applicantId: 'APP-006',
          amount: 30000,
          termMonths: 36,
          purpose: 'Home renovation',
        },
        applicant: {
          age: 45,
          creditScore: 700,
          annualIncome: 90000,
          monthlyDebt: 1500,
          yearsEmployed: 15,
        },
      },
      expected: {
        approved: true,
        reason: 'Approved',
        approvedAmount: 30000,
        termMonths: 36,
        interestRateBps: 550,
      },
    },
    // 优质档利率 (800+ → 350 bps)
    approvedPremiumTier: {
      context: {
        application: {
          applicantId: 'APP-007',
          amount: 100000,
          termMonths: 60,
          purpose: 'Business expansion',
        },
        applicant: {
          age: 50,
          creditScore: 820,
          annualIncome: 200000,
          monthlyDebt: 3000,
          yearsEmployed: 25,
        },
      },
      expected: {
        approved: true,
        reason: 'Approved',
        approvedAmount: 100000,
        termMonths: 60,
        interestRateBps: 350,
      },
    },
  },
};

// ============================================
// 汽车保险领域
// ============================================

export const AUTO_INSURANCE_POLICY = {
  source: `Module aster.insurance.auto.

Define Driver has age: Int, yearsLicensed: Int, accidentsLast5Years: Int, violations: Int.

Define Vehicle has year: Int, value: Int, safetyRating: Int.

Define Quote has approved: Bool, monthlyPremium: Int, riskLevel: Text.

Rule calculateQuote given driver: Driver, vehicle: Vehicle:
  If <(driver.age, 16),:
    Return Quote with approved = false, monthlyPremium = 0, riskLevel = "Ineligible".
  If <(driver.yearsLicensed, 1),:
    Return Quote with approved = false, monthlyPremium = 0, riskLevel = "Ineligible".
  Let basePremium be /(vehicle.value, 100).
  Let ageFactor be calculateAgeFactor(driver.age).
  Let riskFactor be calculateRiskFactor(driver.accidentsLast5Years, driver.violations).
  Let premium be *(basePremium, /(+(ageFactor, riskFactor), 200)).
  Let risk be determineRisk(riskFactor).
  Return Quote with approved = true, monthlyPremium = premium, riskLevel = risk.

Rule calculateAgeFactor given age: Int:
  If <(age, 25),:
    Return 150.
  If <(age, 65),:
    Return 100.
  Return 120.

Rule calculateRiskFactor given accidents: Int, violations: Int:
  Return +(*(accidents, 50), *(violations, 25)).

Rule determineRisk given factor: Int:
  If <(factor, 50),:
    Return "Low".
  If <(factor, 100),:
    Return "Medium".
  Return "High".
`,
  locale: 'en-US',
  functionName: 'calculateQuote',
  testCases: {
    // 低风险驾驶员
    lowRisk: {
      context: {
        driver: {
          age: 40,
          yearsLicensed: 20,
          accidentsLast5Years: 0,
          violations: 0,
        },
        vehicle: {
          year: 2022,
          value: 30000,
          safetyRating: 5,
        },
      },
      expected: {
        approved: true,
        riskLevel: 'Low',
      },
    },
    // 高风险驾驶员
    highRisk: {
      context: {
        driver: {
          age: 22,
          yearsLicensed: 3,
          accidentsLast5Years: 2,
          violations: 3,
        },
        vehicle: {
          year: 2020,
          value: 45000,
          safetyRating: 4,
        },
      },
      expected: {
        approved: true,
        riskLevel: 'High',
      },
    },
    // 无资格 - 年龄过小
    ineligibleByAge: {
      context: {
        driver: {
          age: 15,
          yearsLicensed: 0,
          accidentsLast5Years: 0,
          violations: 0,
        },
        vehicle: {
          year: 2023,
          value: 20000,
          safetyRating: 5,
        },
      },
      expected: {
        approved: false,
        riskLevel: 'Ineligible',
      },
    },
    // 无资格 - 驾龄不足
    ineligibleByLicense: {
      context: {
        driver: {
          age: 18,
          yearsLicensed: 0,
          accidentsLast5Years: 0,
          violations: 0,
        },
        vehicle: {
          year: 2023,
          value: 25000,
          safetyRating: 5,
        },
      },
      expected: {
        approved: false,
        riskLevel: 'Ineligible',
      },
    },
    // 中等风险驾驶员
    mediumRisk: {
      context: {
        driver: {
          age: 30,
          yearsLicensed: 10,
          accidentsLast5Years: 1,
          violations: 1,
        },
        vehicle: {
          year: 2021,
          value: 35000,
          safetyRating: 4,
        },
      },
      expected: {
        approved: true,
        riskLevel: 'Medium',
      },
    },
    // 年轻驾驶员 (<25岁，高年龄因子)
    youngDriver: {
      context: {
        driver: {
          age: 20,
          yearsLicensed: 2,
          accidentsLast5Years: 0,
          violations: 0,
        },
        vehicle: {
          year: 2022,
          value: 28000,
          safetyRating: 5,
        },
      },
      expected: {
        approved: true,
        riskLevel: 'Low',
      },
    },
    // 老年驾驶员 (>=65岁，中等年龄因子)
    seniorDriver: {
      context: {
        driver: {
          age: 68,
          yearsLicensed: 45,
          accidentsLast5Years: 0,
          violations: 0,
        },
        vehicle: {
          year: 2020,
          value: 32000,
          safetyRating: 5,
        },
      },
      expected: {
        approved: true,
        riskLevel: 'Low',
      },
    },
  },
};

// ============================================
// 欺诈检测领域
// ============================================

export const FRAUD_DETECTION_POLICY = {
  source: `Module aster.fraud.detection.

Define Transaction has amount: Int, merchantCategory: Text, isInternational: Bool, hourOfDay: Int.

Define UserProfile has accountAge: Int, avgTransactionAmount: Int, recentTransactions: Int.

Define FraudResult has blocked: Bool, riskScore: Int, riskLevel: Text.

Rule detectFraud given transaction: Transaction, user: UserProfile:
  Let score be 0.
  If >(transaction.amount, *(user.avgTransactionAmount, 5)),:
    Let score be +(score, 30).
  If transaction.isInternational,:
    Let score be +(score, 20).
  If <(user.accountAge, 30),:
    Let score be +(score, 25).
  If >(transaction.hourOfDay, 22),:
    Let score be +(score, 15).
  If <(transaction.hourOfDay, 6),:
    Let score be +(score, 15).
  Let level be classifyRisk(score).
  Let blocked be >(score, 70).
  Return FraudResult with blocked = blocked, riskScore = score, riskLevel = level.

Rule classifyRisk given score: Int:
  If <(score, 30),:
    Return "LOW".
  If <(score, 60),:
    Return "MEDIUM".
  Return "HIGH".
`,
  locale: 'en-US',
  functionName: 'detectFraud',
  testCases: {
    // 正常交易
    normalTransaction: {
      context: {
        transaction: {
          amount: 100,
          merchantCategory: 'grocery',
          isInternational: false,
          hourOfDay: 14,
        },
        user: {
          accountAge: 365,
          avgTransactionAmount: 150,
          recentTransactions: 10,
        },
      },
      expected: {
        blocked: false,
        riskLevel: 'LOW',
      },
    },
    // 可疑交易
    suspiciousTransaction: {
      context: {
        transaction: {
          amount: 5000,
          merchantCategory: 'electronics',
          isInternational: true,
          hourOfDay: 3,
        },
        user: {
          accountAge: 15,
          avgTransactionAmount: 200,
          recentTransactions: 5,
        },
      },
      expected: {
        blocked: true,
        riskLevel: 'HIGH',
      },
    },
    // 中等风险交易 (国际交易 + 新账户)
    mediumRiskTransaction: {
      context: {
        transaction: {
          amount: 200,
          merchantCategory: 'retail',
          isInternational: true,
          hourOfDay: 14,
        },
        user: {
          accountAge: 20,
          avgTransactionAmount: 150,
          recentTransactions: 8,
        },
      },
      expected: {
        blocked: false,
        riskLevel: 'MEDIUM',
      },
    },
    // 深夜交易 (22点后)
    lateNightTransaction: {
      context: {
        transaction: {
          amount: 100,
          merchantCategory: 'food',
          isInternational: false,
          hourOfDay: 23,
        },
        user: {
          accountAge: 365,
          avgTransactionAmount: 120,
          recentTransactions: 15,
        },
      },
      expected: {
        blocked: false,
        riskLevel: 'LOW',
      },
    },
    // 凌晨交易 (6点前)
    earlyMorningTransaction: {
      context: {
        transaction: {
          amount: 150,
          merchantCategory: 'gas',
          isInternational: false,
          hourOfDay: 4,
        },
        user: {
          accountAge: 180,
          avgTransactionAmount: 100,
          recentTransactions: 12,
        },
      },
      expected: {
        blocked: false,
        riskLevel: 'LOW',
      },
    },
  },
};

// ============================================
// 简单策略 - 用于基础功能测试
// ============================================

export const SIMPLE_POLICIES = {
  // 年龄检查
  ageCheck: {
    source: `Module test.validation.

Rule checkAge given age: Int:
  If <(age, 18),:
    Return false.
  If >(age, 65),:
    Return false.
  Return true.
`,
    locale: 'en-US',
    functionName: 'checkAge',
    testCases: {
      valid: { context: { age: 30 }, expected: true },
      tooYoung: { context: { age: 15 }, expected: false },
      tooOld: { context: { age: 70 }, expected: false },
    },
  },

  // 信用评分计算
  creditScore: {
    source: `Module test.credit.

Define ScoreInput has baseScore: Int, bonus: Int.

Rule calculateScore given input: ScoreInput:
  Return +(input.baseScore, input.bonus).
`,
    locale: 'en-US',
    functionName: 'calculateScore',
    testCases: {
      positive: { context: { input: { baseScore: 600, bonus: 50 } }, expected: 650 },
      noBonus: { context: { input: { baseScore: 700, bonus: 0 } }, expected: 700 },
    },
  },
};

// ============================================
// 中文策略测试
// ============================================

export const CHINESE_POLICY = {
  source: `模块 金融.贷款。

定义 申请人 包含 编号：文本，信用评分：整数，收入：小数，申请金额：小数。

规则 评估贷款 给定 申请人：
  如果 申请人.信用评分 大于 750：
    返回「批准，优惠利率」。
  否则：
    如果 申请人.信用评分 大于 650：
      返回「批准，标准利率」。
    否则：
      返回「需要人工审核」。
`,
  locale: 'zh-CN',
  functionName: '评估贷款',
  testCases: {
    premium: {
      context: {
        申请人: {
          编号: 'A001',
          信用评分: 800,
          收入: 100000.0,
          申请金额: 50000.0,
        },
      },
      expected: '批准，优惠利率',
    },
    standard: {
      context: {
        申请人: {
          编号: 'A002',
          信用评分: 700,
          收入: 80000.0,
          申请金额: 30000.0,
        },
      },
      expected: '批准，标准利率',
    },
    manualReview: {
      context: {
        申请人: {
          编号: 'A003',
          信用评分: 600,
          收入: 50000.0,
          申请金额: 20000.0,
        },
      },
      expected: '需要人工审核',
    },
  },
};

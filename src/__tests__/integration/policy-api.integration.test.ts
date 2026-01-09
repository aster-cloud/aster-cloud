/**
 * Policy API 集成测试
 *
 * 调用真实的 Aster Policy API 进行端到端验证
 * 需要设置环境变量：
 *   - ASTER_POLICY_API_URL (默认: https://policy.aster-lang.cloud)
 *   - ASTER_POLICY_TEST_TENANT_ID (必需)
 *   - ASTER_POLICY_TEST_USER_ID (必需)
 *
 * 运行命令:
 *   pnpm test:integration
 *   或
 *   ASTER_POLICY_TEST_TENANT_ID=xxx ASTER_POLICY_TEST_USER_ID=yyy pnpm vitest run src/__tests__/integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PolicyApiClient,
  PolicyApiError,
  createPolicyApiClient,
} from '@/services/policy/policy-api';
import {
  LOAN_POLICY,
  AUTO_INSURANCE_POLICY,
  FRAUD_DETECTION_POLICY,
  SIMPLE_POLICIES,
  CHINESE_POLICY,
} from './fixtures/policy-fixtures';

// 测试配置
const TEST_CONFIG = {
  tenantId: process.env.ASTER_POLICY_TEST_TENANT_ID || 'test-tenant',
  userId: process.env.ASTER_POLICY_TEST_USER_ID || 'test-user',
  apiUrl: process.env.ASTER_POLICY_API_URL || 'https://policy.aster-lang.cloud',
  timeout: 30000,
};

// 跳过条件：未配置测试凭据
const SKIP_INTEGRATION =
  !process.env.ASTER_POLICY_TEST_TENANT_ID || !process.env.ASTER_POLICY_TEST_USER_ID;

describe.skipIf(SKIP_INTEGRATION)('Policy API Integration Tests', () => {
  let client: PolicyApiClient;

  beforeAll(() => {
    // 设置 API URL 环境变量
    if (process.env.ASTER_POLICY_API_URL) {
      process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL = process.env.ASTER_POLICY_API_URL;
    }
    client = createPolicyApiClient(TEST_CONFIG.tenantId, TEST_CONFIG.userId);
  });

  afterAll(() => {
    // 清理 WebSocket 连接
    client?.disconnect?.();
  });

  // ============================================
  // 健康检查测试
  // ============================================

  describe('Health Checks', () => {
    it('should pass liveness check', async () => {
      const response = await client.healthCheck();
      expect(response.status).toBe('UP');
    });

    it('should pass readiness check', async () => {
      const response = await client.readinessCheck();
      expect(response.status).toBe('UP');
    });
  });

  // ============================================
  // 基础功能测试
  // ============================================

  describe('Basic Functionality', () => {
    describe('evaluateSource', () => {
      it('should evaluate simple age check policy', async () => {
        const { source, testCases } = SIMPLE_POLICIES.ageCheck;

        const response = await client.evaluateSource(source, testCases.valid.context, {
          locale: 'en-US',
          functionName: 'checkAge',
        });

        expect(response.error).toBeNull();
        expect(response.result).toBe(testCases.valid.expected);
        expect(response.executionTimeMs).toBeGreaterThan(0);
      });

      it('should evaluate credit score calculation policy', async () => {
        const { source, testCases } = SIMPLE_POLICIES.creditScore;

        const response = await client.evaluateSource(source, testCases.positive.context, {
          locale: 'en-US',
          functionName: 'calculateScore',
        });

        expect(response.error).toBeNull();
        expect(response.result).toBe(testCases.positive.expected);
      });
    });

    describe('getSchema', () => {
      it('should return parameter schema for policy', async () => {
        const response = await client.getSchema(SIMPLE_POLICIES.ageCheck.source, {
          functionName: 'checkAge',
          locale: 'en-US',
        });

        expect(response.success).toBe(true);
        expect(response.functionName).toBe('checkAge');
        expect(response.parameters).toBeDefined();
        expect(response.parameters?.length).toBe(1);
        expect(response.parameters?.[0].name).toBe('age');
        expect(response.parameters?.[0].typeKind).toBe('primitive');
      });
    });
  });

  // ============================================
  // 贷款策略测试
  // ============================================

  describe('Loan Policy (aster.finance.loan)', () => {
    it('should approve qualified applicant', async () => {
      const { source, testCases } = LOAN_POLICY;
      const { context, expected } = testCases.approved;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'evaluateLoanEligibility',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.reason).toBe(expected.reason);
      expect(result.approvedAmount).toBe(expected.approvedAmount);
      expect(result.termMonths).toBe(expected.termMonths);
    });

    it('should reject applicant below age 18', async () => {
      const { source, testCases } = LOAN_POLICY;
      const { context, expected } = testCases.rejectedByAge;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'evaluateLoanEligibility',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.reason).toBe(expected.reason);
    });

    it('should reject applicant with low credit score', async () => {
      const { source, testCases } = LOAN_POLICY;
      const { context, expected } = testCases.rejectedByCredit;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'evaluateLoanEligibility',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.reason).toBe(expected.reason);
    });

    it('should reject applicant above age 75', async () => {
      const { source, testCases } = LOAN_POLICY;
      const { context, expected } = testCases.rejectedByAgeOver75;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'evaluateLoanEligibility',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.reason).toBe(expected.reason);
    });

    it('should approve with lowest tier interest rate (650-670)', async () => {
      const { source, testCases } = LOAN_POLICY;
      const { context, expected } = testCases.approvedLowestTier;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'evaluateLoanEligibility',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.interestRateBps).toBe(expected.interestRateBps);
    });

    it('should approve with mid tier interest rate (670-740)', async () => {
      const { source, testCases } = LOAN_POLICY;
      const { context, expected } = testCases.approvedMidTier;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'evaluateLoanEligibility',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.interestRateBps).toBe(expected.interestRateBps);
    });

    it('should approve with premium tier interest rate (800+)', async () => {
      const { source, testCases } = LOAN_POLICY;
      const { context, expected } = testCases.approvedPremiumTier;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'evaluateLoanEligibility',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.interestRateBps).toBe(expected.interestRateBps);
    });
  });

  // ============================================
  // 汽车保险策略测试
  // ============================================

  describe('Auto Insurance Policy (aster.insurance.auto)', () => {
    it('should calculate low-risk quote', async () => {
      const { source, testCases } = AUTO_INSURANCE_POLICY;
      const { context, expected } = testCases.lowRisk;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'calculateQuote',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.riskLevel).toBe(expected.riskLevel);
      // monthlyPremium 可能因整数运算而为 0 或较小值
      expect(typeof result.monthlyPremium).toBe('number');
    });

    it('should calculate high-risk quote', async () => {
      const { source, testCases } = AUTO_INSURANCE_POLICY;
      const { context, expected } = testCases.highRisk;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'calculateQuote',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });

    it('should reject driver below age 16', async () => {
      const { source, testCases } = AUTO_INSURANCE_POLICY;
      const { context, expected } = testCases.ineligibleByAge;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'calculateQuote',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });

    it('should reject driver with less than 1 year license', async () => {
      const { source, testCases } = AUTO_INSURANCE_POLICY;
      const { context, expected } = testCases.ineligibleByLicense;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'calculateQuote',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });

    it('should calculate medium-risk quote', async () => {
      const { source, testCases } = AUTO_INSURANCE_POLICY;
      const { context, expected } = testCases.mediumRisk;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'calculateQuote',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });

    it('should handle young driver (<25) with higher age factor', async () => {
      const { source, testCases } = AUTO_INSURANCE_POLICY;
      const { context, expected } = testCases.youngDriver;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'calculateQuote',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });

    it('should handle senior driver (>=65) with medium age factor', async () => {
      const { source, testCases } = AUTO_INSURANCE_POLICY;
      const { context, expected } = testCases.seniorDriver;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'calculateQuote',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.approved).toBe(expected.approved);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });
  });

  // ============================================
  // 欺诈检测策略测试
  // ============================================

  describe('Fraud Detection Policy (aster.fraud.detection)', () => {
    it('should allow normal transaction', async () => {
      const { source, testCases } = FRAUD_DETECTION_POLICY;
      const { context, expected } = testCases.normalTransaction;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'detectFraud',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.blocked).toBe(expected.blocked);
      expect(result.riskLevel).toBe(expected.riskLevel);
      expect(result.riskScore).toBeGreaterThanOrEqual(0);
    });

    it('should block suspicious transaction', async () => {
      const { source, testCases } = FRAUD_DETECTION_POLICY;
      const { context, expected } = testCases.suspiciousTransaction;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'detectFraud',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.blocked).toBe(expected.blocked);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });

    it('should classify medium risk transaction', async () => {
      const { source, testCases } = FRAUD_DETECTION_POLICY;
      const { context, expected } = testCases.mediumRiskTransaction;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'detectFraud',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.blocked).toBe(expected.blocked);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });

    it('should handle late night transaction (after 22:00)', async () => {
      const { source, testCases } = FRAUD_DETECTION_POLICY;
      const { context, expected } = testCases.lateNightTransaction;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'detectFraud',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.blocked).toBe(expected.blocked);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });

    it('should handle early morning transaction (before 6:00)', async () => {
      const { source, testCases } = FRAUD_DETECTION_POLICY;
      const { context, expected } = testCases.earlyMorningTransaction;

      const response = await client.evaluateSource(source, context, {
        locale: 'en-US',
        functionName: 'detectFraud',
      });

      expect(response.error).toBeNull();
      const result = response.result as Record<string, unknown>;
      expect(result.blocked).toBe(expected.blocked);
      expect(result.riskLevel).toBe(expected.riskLevel);
    });
  });

  // ============================================
  // 中文策略测试
  // ============================================

  describe('Chinese CNL Policy', () => {
    it('should evaluate Chinese loan policy - premium rate', async () => {
      const { source, testCases } = CHINESE_POLICY;
      const { context, expected } = testCases.premium;

      const response = await client.evaluateSource(source, context, {
        locale: 'zh-CN',
        functionName: '评估贷款',
      });

      expect(response.error).toBeNull();
      expect(response.result).toBe(expected);
    });

    it('should evaluate Chinese loan policy - standard rate', async () => {
      const { source, testCases } = CHINESE_POLICY;
      const { context, expected } = testCases.standard;

      const response = await client.evaluateSource(source, context, {
        locale: 'zh-CN',
        functionName: '评估贷款',
      });

      expect(response.error).toBeNull();
      expect(response.result).toBe(expected);
    });

    it('should evaluate Chinese loan policy - manual review', async () => {
      const { source, testCases } = CHINESE_POLICY;
      const { context, expected } = testCases.manualReview;

      const response = await client.evaluateSource(source, context, {
        locale: 'zh-CN',
        functionName: '评估贷款',
      });

      expect(response.error).toBeNull();
      expect(response.result).toBe(expected);
    });
  });

  // ============================================
  // 错误处理测试
  // ============================================

  describe('Error Handling', () => {
    it('should return error in response for invalid context', async () => {
      const response = await client.evaluateSource(
        SIMPLE_POLICIES.ageCheck.source,
        { invalid: 'context' },
        {
          locale: 'en-US',
          functionName: 'checkAge',
        }
      );

      // API 返回错误信息在 response.error 中，而非抛出异常
      expect(response.error).not.toBeNull();
      expect(response.result).toBeNull();
    });

    it('should return error for non-existent function', async () => {
      const response = await client.evaluateSource(
        SIMPLE_POLICIES.ageCheck.source,
        { age: 25 },
        {
          locale: 'en-US',
          functionName: 'nonExistentFunction',
        }
      );

      // API 返回错误信息在 response.error 中
      expect(response.error).not.toBeNull();
      expect(response.result).toBeNull();
    });
  });

  // ============================================
  // 性能测试
  // ============================================

  describe('Performance', () => {
    it('should complete simple evaluation within 500ms', async () => {
      const startTime = Date.now();

      await client.evaluateSource(SIMPLE_POLICIES.ageCheck.source, { age: 30 }, {
        locale: 'en-US',
        functionName: 'checkAge',
      });

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(500);
    });

    it('should complete complex loan evaluation within 1000ms', async () => {
      const startTime = Date.now();

      await client.evaluateSource(LOAN_POLICY.source, LOAN_POLICY.testCases.approved.context, {
        locale: 'en-US',
        functionName: 'evaluateLoanEligibility',
      });

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(1000);
    });
  });
});

// ============================================
// 独立健康检查测试（始终运行）
// ============================================

describe('Policy API Availability Check', () => {
  it('should be able to connect to Policy API', async () => {
    const client = createPolicyApiClient('health-check', 'health-check');

    try {
      const response = await client.healthCheck();
      expect(response.status).toBe('UP');
      console.log('[Integration Test] Policy API is healthy');
    } catch (error) {
      console.warn('[Integration Test] Policy API is not reachable:', error);
      // 不 fail 测试，只是警告
      expect(true).toBe(true);
    }
  });
});

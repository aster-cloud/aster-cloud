import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/stripe/checkout/route';
import { auth } from '@/auth';
import { getPlanStripePriceId } from '@/lib/plans';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

// 模拟 deployment-mode 让 CAN_BILLING = true（默认）；on-prem 测试见
// __tests__/lib/deployment-mode.test.ts。其它 deployment-mode 导出按需 stub。
vi.mock('@/lib/deployment-mode', () => ({
  CAN_BILLING: true,
  IS_SAAS: true,
  IS_ONPREM: false,
}));

// Stripe mock 是一个共享单例对象 —— 每次 getStripe() 都返回它，
// 让 mockCreateCheckoutSession 在所有调用间稳定可断言。
const mockStripeInstance = {
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
};
vi.mock('@/lib/stripe', () => ({
  getStripe: vi.fn(async () => mockStripeInstance),
}));

vi.mock('@/lib/plans', () => ({
  getPlanStripePriceId: vi.fn(),
  CURRENCY_CONFIG: {
    USD: { symbol: '$', code: 'USD', locale: 'en-US' },
    CNY: { symbol: '¥', code: 'CNY', locale: 'zh-CN' },
    EUR: { symbol: '€', code: 'EUR', locale: 'de-DE' },
  },
}));

// Stub the risk-tier gate's DB lookup. Default = trusted (tier 0) so the
// pre-existing test cases still pass without enumerating riskTier.
vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      users: {
        findFirst: vi.fn(async () => ({ riskTier: 0, riskTierReason: null })),
      },
    },
  },
}));

const mockAuth = vi.mocked(auth);
const mockGetPlanStripePriceId = vi.mocked(getPlanStripePriceId);
// Cast to mock function for proper typing
type MockFn = ReturnType<typeof vi.fn>;
const mockCreateCheckoutSession =
  mockStripeInstance.checkout.sessions.create as unknown as MockFn;

function createRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('Stripe Checkout API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
    mockGetPlanStripePriceId.mockReturnValue('price_123');
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
    } as unknown as Awaited<ReturnType<typeof auth>>);
  });

  describe('认证校验', () => {
    it('should return 401 when not authenticated', async () => {
      mockAuth.mockResolvedValue(null as unknown as Awaited<ReturnType<typeof auth>>);

      const response = await POST(
        createRequest({
          plan: 'pro',
          interval: 'monthly',
        })
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    });

    it('should use session user info instead of request body', async () => {
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      const response = await POST(
        createRequest({
          plan: 'pro',
          interval: 'monthly',
          userId: 'fake-user',
          email: 'fake@example.com',
        })
      );

      expect(response.status).toBe(200);
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_email: 'user@example.com',
          client_reference_id: 'user-1',
          metadata: expect.objectContaining({
            userId: 'user-1',
          }),
        })
      );
    });
  });

  describe('请求参数校验', () => {
    it('should return 400 when plan is missing', async () => {
      const response = await POST(
        createRequest({
          interval: 'monthly',
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Missing required fields');
    });

    it('should return 400 when interval is missing', async () => {
      const response = await POST(
        createRequest({
          plan: 'pro',
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Missing required fields');
    });

    it('should return 400 for free plan checkout', async () => {
      const response = await POST(
        createRequest({
          plan: 'free',
          interval: 'monthly',
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Cannot checkout for free plan');
    });

    it('should return 400 when price ID not configured', async () => {
      mockGetPlanStripePriceId.mockReturnValue(null);

      const response = await POST(
        createRequest({
          plan: 'pro',
          interval: 'monthly',
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Invalid plan, interval, or currency configuration');
    });
  });

  describe('Pro 计划数量处理（PM v1.1：起步 1 席）', () => {
    it('should default quantity to 1 when not specified', async () => {
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      const response = await POST(
        createRequest({
          plan: 'pro',
          interval: 'monthly',
        })
      );

      expect(response.status).toBe(200);
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            expect.objectContaining({
              quantity: 1,
            }),
          ],
        })
      );
    });

    it('should accept arbitrary quantity for pro plan (multi-seat purchase)', async () => {
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      const response = await POST(
        createRequest({
          plan: 'pro',
          interval: 'monthly',
          quantity: 10,
        })
      );

      expect(response.status).toBe(200);
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            expect.objectContaining({
              quantity: 10,
            }),
          ],
        })
      );
    });
  });

  describe('货币处理', () => {
    it('should default to USD for invalid currency', async () => {
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      const response = await POST(
        createRequest({
          plan: 'pro',
          interval: 'monthly',
          currency: 'INVALID',
        })
      );

      expect(response.status).toBe(200);
      expect(mockGetPlanStripePriceId).toHaveBeenCalledWith('pro', 'monthly', 'USD');
    });

    it('should use valid currency when provided', async () => {
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      const response = await POST(
        createRequest({
          plan: 'pro',
          interval: 'monthly',
          currency: 'CNY',
        })
      );

      expect(response.status).toBe(200);
      expect(mockGetPlanStripePriceId).toHaveBeenCalledWith('pro', 'monthly', 'CNY');
    });
  });

  describe('错误处理', () => {
    it('should return 500 when Stripe API fails', async () => {
      mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe API error'));

      const response = await POST(
        createRequest({
          plan: 'pro',
          interval: 'monthly',
        })
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Failed to create checkout session');
    });
  });

  describe('风险等级 gate (risk-tier)', () => {
    it('tier 3 blocks checkout with 403 + reason', async () => {
      const { db } = await import('@/lib/prisma');
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        riskTier: 3,
        riskTierReason: 'prior_purge=3',
      } as never);

      const response = await POST(
        createRequest({ plan: 'pro', interval: 'monthly' })
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('checkout_blocked_by_risk_tier');
      expect(body.reason).toBe('prior_purge=3');
      // Stripe should not have been reached
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    });

    it('tier 0 (trusted) goes through normally', async () => {
      const { db } = await import('@/lib/prisma');
      vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
        riskTier: 0,
        riskTierReason: null,
      } as never);
      mockGetPlanStripePriceId.mockReturnValue('price_test_pro');
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test_ok',
        url: 'https://checkout.stripe.com/test',
      } as never);

      const response = await POST(
        createRequest({ plan: 'pro', interval: 'monthly' })
      );

      expect(response.status).toBe(200);
      expect(mockCreateCheckoutSession).toHaveBeenCalled();
    });
  });
});

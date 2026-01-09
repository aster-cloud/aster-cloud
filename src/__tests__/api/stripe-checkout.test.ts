import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/stripe/checkout/route';
import { getServerSession } from 'next-auth';
import { getPlanStripePriceId } from '@/lib/plans';
import { stripe } from '@/lib/stripe';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
  },
}));

vi.mock('@/lib/plans', () => ({
  getPlanStripePriceId: vi.fn(),
  CURRENCY_CONFIG: {
    USD: { symbol: '$', code: 'USD', locale: 'en-US' },
    CNY: { symbol: '¥', code: 'CNY', locale: 'zh-CN' },
    EUR: { symbol: '€', code: 'EUR', locale: 'de-DE' },
  },
}));

const mockGetServerSession = vi.mocked(getServerSession);
const mockGetPlanStripePriceId = vi.mocked(getPlanStripePriceId);
const mockCreateCheckoutSession = vi.mocked(stripe.checkout.sessions.create);

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
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com' },
    } as Awaited<ReturnType<typeof getServerSession>>);
  });

  describe('认证校验', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValue(null);

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

  describe('Team 计划数量处理', () => {
    it('should enforce minimum 3 users for team plan', async () => {
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      const response = await POST(
        createRequest({
          plan: 'team',
          interval: 'monthly',
          quantity: 1, // 少于最低要求
        })
      );

      expect(response.status).toBe(200);
      expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [
            expect.objectContaining({
              quantity: 3, // 应该被强制为最小值 3
            }),
          ],
        })
      );
    });

    it('should accept quantity >= 3 for team plan', async () => {
      mockCreateCheckoutSession.mockResolvedValue({
        id: 'cs_test',
        url: 'https://stripe.test/session',
      });

      const response = await POST(
        createRequest({
          plan: 'team',
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
});

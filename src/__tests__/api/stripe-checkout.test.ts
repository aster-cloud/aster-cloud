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
  });

  it('should reject unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        plan: 'pro',
        interval: 'monthly',
      })
    );

    expect(response.status).toBe(401);
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it('should use session user info instead of request body', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'real-user', email: 'real@example.com' },
    } as any);

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
        customer_email: 'real@example.com',
        client_reference_id: 'real-user',
        metadata: expect.objectContaining({
          userId: 'real-user',
        }),
      })
    );
  });
});

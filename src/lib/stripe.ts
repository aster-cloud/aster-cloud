import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-11-17.clover',
  typescript: true,
});

// Price IDs for subscription plans
export const PRICE_IDS = {
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY!,
    yearly: process.env.STRIPE_PRICE_PRO_YEARLY!,
  },
  team: {
    monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY!,
    yearly: process.env.STRIPE_PRICE_TEAM_YEARLY!,
  },
} as const;

// Plan features for display
export const PLANS = {
  free: {
    name: 'Free',
    price: { monthly: 0, yearly: 0 },
    features: [
      '100 executions/month',
      '3 saved policies',
      'Basic PII detection',
      'Community support',
    ],
  },
  pro: {
    name: 'Pro',
    price: { monthly: 49, yearly: 470 },
    features: [
      'Unlimited executions',
      'Unlimited policies',
      'Advanced PII detection',
      'Policy sharing',
      'Compliance reports',
      'API access',
      'Priority support',
    ],
  },
  team: {
    name: 'Team',
    price: { monthly: 199, yearly: 1910 },
    features: [
      'Everything in Pro',
      'Team collaboration',
      'Role-based access',
      'Shared policy library',
      'Team analytics',
      'SSO (coming soon)',
    ],
  },
} as const;

export type PlanType = keyof typeof PLANS;
export type BillingInterval = 'monthly' | 'yearly';
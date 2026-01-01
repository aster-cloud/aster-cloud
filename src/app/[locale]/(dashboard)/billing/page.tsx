'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  BillingInterval,
  getPlanStripePriceId,
  isUnlimited,
  PLANS,
  PlanType,
} from '@/lib/plans';

const DISPLAY_PLANS = (Object.keys(PLANS) as PlanType[]).filter((plan) => plan !== 'trial');

function BillingContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [usage, setUsage] = useState<{
    executions: number;
    executionsLimit: number;
    policies: number;
    policiesLimit: number;
  } | null>(null);

  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setMessage({ type: 'success', text: 'Subscription activated successfully!' });
    } else if (searchParams.get('canceled') === 'true') {
      setMessage({ type: 'error', text: 'Checkout was canceled.' });
    }

    // Fetch usage stats
    fetchUsage();
  }, [searchParams]);

  const fetchUsage = async () => {
    try {
      const res = await fetch('/api/user/usage');
      if (res.ok) {
        const data = await res.json();
        setUsage(data.usage);
      }
    } catch (error) {
      console.error('Failed to fetch usage:', error);
    }
  };

  const handleCheckout = async (plan: PlanType) => {
    if (!session?.user?.id) return;

    setIsLoading(plan);

    if (!getPlanStripePriceId(plan, interval)) {
      setMessage({
        type: 'error',
        text: 'Selected plan is not available for checkout. Please contact support.',
      });
      setIsLoading(null);
      return;
    }

    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          interval,
          userId: session.user.id,
          email: session.user.email,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Something went wrong',
      });
    } finally {
      setIsLoading(null);
    }
  };

  const currentPlan = (session?.user?.plan || 'free') as PlanType;

  return (
    <div>
      <div className="md:flex md:items-center md:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Billing & Subscription</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your subscription and billing details
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`mb-6 rounded-md p-4 ${
            message.type === 'success' ? 'bg-green-50' : 'bg-red-50'
          }`}
        >
          <p
            className={`text-sm ${
              message.type === 'success' ? 'text-green-700' : 'text-red-700'
            }`}
          >
            {message.text}
          </p>
        </div>
      )}

      {/* Current Plan */}
      <div className="bg-white shadow sm:rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900">Current Plan</h3>
          <div className="mt-3 flex items-center">
            <span className="text-3xl font-bold text-gray-900 capitalize">
              {currentPlan}
            </span>
            {currentPlan === 'trial' && session?.user?.trialEndsAt && (
              <span className="ml-4 text-sm text-gray-500">
                Trial ends {new Date(session.user.trialEndsAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Usage */}
          {usage && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Executions this month</p>
                <p className="text-lg font-medium">
                  {usage.executions} / {isUnlimited(usage.executionsLimit) ? '∞' : usage.executionsLimit}
                </p>
                {!isUnlimited(usage.executionsLimit) && (
                  <div className="mt-1 h-2 w-full bg-gray-200 rounded-full">
                    <div
                      className="h-2 bg-indigo-600 rounded-full"
                      style={{
                        width: `${Math.min((usage.executions / usage.executionsLimit) * 100, 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm text-gray-500">Saved policies</p>
                <p className="text-lg font-medium">
                  {usage.policies} / {isUnlimited(usage.policiesLimit) ? '∞' : usage.policiesLimit}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Billing Interval Toggle */}
      <div className="flex justify-center mb-8">
        <div className="relative flex rounded-lg bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setInterval('monthly')}
            className={`relative px-4 py-2 text-sm font-medium rounded-md ${
              interval === 'monthly'
                ? 'bg-white text-gray-900 shadow'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval('yearly')}
            className={`relative px-4 py-2 text-sm font-medium rounded-md ${
              interval === 'yearly'
                ? 'bg-white text-gray-900 shadow'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Yearly
            <span className="ml-1 text-xs text-green-600 font-semibold">Save 20%</span>
          </button>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {DISPLAY_PLANS.map((planKey) => {
          const plan = PLANS[planKey];
          const priceValue = plan.price[interval];
          const isCurrentPlan = currentPlan === planKey;
          const canCheckout = Boolean(getPlanStripePriceId(planKey, interval));
          const isFeatured = planKey === 'pro';
          const showInterval = typeof priceValue === 'number' && priceValue > 0;

          return (
            <div
              key={planKey}
              className={`rounded-lg border-2 bg-white p-6 ${
                isFeatured ? 'border-indigo-600 shadow-lg' : 'border-gray-200'
              }`}
            >
              {isFeatured && (
                <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800 mb-4">
                  Most Popular
                </span>
              )}

              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                {plan.name}
                <span className="text-sm font-normal text-gray-500">{plan.displayName}</span>
              </h3>

              <div className="mt-4 flex items-baseline">
                {priceValue === null ? (
                  <span className="text-2xl font-semibold text-gray-700">Contact sales</span>
                ) : (
                  <>
                    <span className="text-4xl font-bold text-gray-900">${priceValue}</span>
                    {showInterval && (
                      <span className="ml-1 text-gray-500">/{interval === 'yearly' ? 'year' : 'month'}</span>
                    )}
                  </>
                )}
              </div>

              <ul className="mt-6 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center text-sm text-gray-600">
                    <svg className="h-4 w-4 text-green-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                {isCurrentPlan ? (
                  <button
                    disabled
                    className="w-full rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-400"
                  >
                    Current Plan
                  </button>
                ) : canCheckout ? (
                  <button
                    onClick={() => handleCheckout(planKey)}
                    disabled={isLoading !== null}
                    className={`w-full rounded-md px-4 py-2 text-sm font-semibold shadow-sm ${
                      planKey === 'pro'
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                        : 'bg-gray-900 text-white hover:bg-gray-800'
                    } disabled:opacity-50`}
                  >
                    {isLoading === planKey ? 'Loading...' : `Upgrade to ${plan.name}`}
                  </button>
                ) : planKey === 'free' ? (
                  <button
                    disabled
                    className="w-full rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-500"
                  >
                    Free Tier
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-500"
                  >
                    Contact Sales
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* FAQ */}
      <div className="mt-12">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Frequently Asked Questions</h2>
        <div className="space-y-4">
          <details className="bg-white rounded-lg shadow px-4 py-3">
            <summary className="font-medium text-gray-900 cursor-pointer">
              Can I cancel my subscription anytime?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              Yes, you can cancel your subscription at any time. Your access will continue until
              the end of your current billing period.
            </p>
          </details>
          <details className="bg-white rounded-lg shadow px-4 py-3">
            <summary className="font-medium text-gray-900 cursor-pointer">
              What happens when my trial ends?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              After your trial ends, you&apos;ll be automatically downgraded to the Free plan. You can
              upgrade to Pro or Team at any time to regain access to premium features.
            </p>
          </details>
          <details className="bg-white rounded-lg shadow px-4 py-3">
            <summary className="font-medium text-gray-900 cursor-pointer">
              Do you offer refunds?
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              We offer a 30-day money-back guarantee. If you&apos;re not satisfied with your subscription,
              contact us within 30 days for a full refund.
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="animate-pulse">Loading billing...</div>}>
      <BillingContent />
    </Suspense>
  );
}

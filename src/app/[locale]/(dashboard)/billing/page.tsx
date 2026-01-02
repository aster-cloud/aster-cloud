'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations, useLocale } from 'next-intl';
import {
  BillingInterval,
  CurrencyCode,
  CURRENCY_CONFIG,
  formatPrice,
  getCurrencyForLocale,
  getPlanPrice,
  getPlanStripePriceId,
  getTeamMinUsers,
  getTeamPerUserPrice,
  isUnlimited,
  PLANS,
  PlanType,
} from '@/lib/plans';

const DISPLAY_PLANS = (Object.keys(PLANS) as PlanType[]).filter((plan) => plan !== 'trial');
const AVAILABLE_CURRENCIES: CurrencyCode[] = ['USD', 'CNY', 'EUR'];

// Currency display names
const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  USD: 'US Dollar ($)',
  CNY: '人民币 (¥)',
  EUR: 'Euro (€)',
};

function BillingContent() {
  const t = useTranslations('billing');
  const locale = useLocale();
  const defaultCurrency = getCurrencyForLocale(locale) as CurrencyCode;
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency);
  const [interval, setInterval] = useState<BillingInterval>('monthly');
  const [teamUsers, setTeamUsers] = useState<number>(getTeamMinUsers());
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
      setMessage({ type: 'success', text: t('subscriptionActivated') });
    } else if (searchParams.get('canceled') === 'true') {
      setMessage({ type: 'error', text: t('checkoutCanceled') });
    }

    // Fetch usage stats
    fetchUsage();
  }, [searchParams, t]);

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

    if (!getPlanStripePriceId(plan, interval, currency)) {
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
          currency,
          quantity: plan === 'team' ? teamUsers : 1,
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
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('subtitle')}
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
          <h3 className="text-lg font-medium text-gray-900">{t('currentPlan')}</h3>
          <div className="mt-3 flex items-center">
            <span className="text-3xl font-bold text-gray-900">
              {t(`plans.names.${currentPlan}`)}
            </span>
            {currentPlan === 'trial' && session?.user?.trialEndsAt && (
              <span className="ml-4 text-sm text-gray-500">
                {t('trialEnds', { date: new Date(session.user.trialEndsAt).toLocaleDateString() })}
              </span>
            )}
          </div>

          {/* Usage */}
          {usage && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">{t('executionsThisMonth')}</p>
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
                <p className="text-sm text-gray-500">{t('savedPolicies')}</p>
                <p className="text-lg font-medium">
                  {usage.policies} / {isUnlimited(usage.policiesLimit) ? '∞' : usage.policiesLimit}
                </p>
                {!isUnlimited(usage.policiesLimit) && (
                  <div className="mt-1 h-2 w-full bg-gray-200 rounded-full">
                    <div
                      className="h-2 bg-indigo-600 rounded-full"
                      style={{
                        width: `${Math.min((usage.policies / usage.policiesLimit) * 100, 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Billing Options: Interval Toggle + Currency Selector */}
      <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-8">
        {/* Billing Interval Toggle */}
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
            {t('monthly')}
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
            {t('yearly')}
            <span className="ml-1 text-xs text-green-600 font-semibold">{t('save20')}</span>
          </button>
        </div>

        {/* Currency Selector */}
        <div className="relative">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            className="appearance-none bg-white border border-gray-300 rounded-lg px-4 py-2 pr-8 text-sm font-medium text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer"
          >
            {AVAILABLE_CURRENCIES.map((curr) => (
              <option key={curr} value={curr}>
                {CURRENCY_NAMES[curr]}
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {DISPLAY_PLANS.map((planKey) => {
          const plan = PLANS[planKey];
          const isTeamPlan = planKey === 'team';
          const isCurrentPlan = currentPlan === planKey;
          const canCheckout = Boolean(getPlanStripePriceId(planKey, interval, currency));
          const isFeatured = planKey === 'pro';

          // Calculate price based on plan type
          let priceValue: number | null;
          let priceLabel: string;

          if (isTeamPlan) {
            const perUserPrice = getTeamPerUserPrice(currency, interval);
            priceValue = perUserPrice * teamUsers;
            priceLabel = `${formatPrice(perUserPrice, currency)}/${t('perUser')}`;
          } else {
            priceValue = getPlanPrice(planKey, currency)[interval];
            priceLabel = '';
          }

          const showInterval = typeof priceValue === 'number' && priceValue > 0;

          return (
            <div
              key={planKey}
              className={`rounded-2xl bg-white p-8 flex flex-col ${
                isFeatured ? 'border-2 border-indigo-600 shadow-xl' : 'border border-gray-200'
              }`}
            >
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                {t(`plans.names.${planKey}`)}
                {isFeatured && (
                  <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800">
                    {t('mostPopular')}
                  </span>
                )}
              </h3>

              <div className="mt-4 flex items-baseline">
                {priceValue === null ? (
                  <span className="text-2xl font-semibold text-gray-700">{t('contactSales')}</span>
                ) : (
                  <>
                    <span className="text-4xl font-bold text-gray-900">
                      {formatPrice(priceValue, currency)}
                    </span>
                    {showInterval && (
                      <span className="ml-1 text-gray-500">/{interval === 'yearly' ? t('year') : t('month')}</span>
                    )}
                  </>
                )}
              </div>

              {/* Per user price for Team plan */}
              {isTeamPlan && priceLabel && (
                <p className="mt-1 text-sm text-gray-500">{priceLabel}</p>
              )}

              {/* Team users selector */}
              {isTeamPlan && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('teamUsers')}
                  </label>
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => setTeamUsers(Math.max(getTeamMinUsers(), teamUsers - 1))}
                      disabled={teamUsers <= getTeamMinUsers()}
                      className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={getTeamMinUsers()}
                      max={100}
                      value={teamUsers}
                      onChange={(e) => setTeamUsers(Math.max(getTeamMinUsers(), Math.min(100, parseInt(e.target.value) || getTeamMinUsers())))}
                      className="w-16 text-center border border-gray-300 rounded-md py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setTeamUsers(Math.min(100, teamUsers + 1))}
                      disabled={teamUsers >= 100}
                      className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      +
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {t('minUsers', { count: getTeamMinUsers() })}
                  </p>
                </div>
              )}

              <ul className="mt-6 space-y-3 flex-1">
                {plan.featureKeys.map((featureKey) => (
                  <li key={featureKey} className="flex items-center text-sm text-gray-600">
                    <svg className="h-4 w-4 text-green-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {t(`plans.features.${featureKey}`)}
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-8">
                {isCurrentPlan ? (
                  <button
                    disabled
                    className="w-full rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-400"
                  >
                    {t('currentPlanButton')}
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
                    {isLoading === planKey ? t('loading') : t('upgradeTo', { plan: t(`plans.names.${planKey}`) })}
                  </button>
                ) : planKey === 'free' ? (
                  <button
                    disabled
                    className="w-full rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-500"
                  >
                    {t('freeTier')}
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full rounded-md bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-500"
                  >
                    {t('contactSales')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* FAQ */}
      <div className="mt-12">
        <h2 className="text-lg font-medium text-gray-900 mb-4">{t('faq.title')}</h2>
        <div className="space-y-4">
          <details className="bg-white rounded-lg shadow px-4 py-3">
            <summary className="font-medium text-gray-900 cursor-pointer">
              {t('faq.cancelAnytime.question')}
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              {t('faq.cancelAnytime.answer')}
            </p>
          </details>
          <details className="bg-white rounded-lg shadow px-4 py-3">
            <summary className="font-medium text-gray-900 cursor-pointer">
              {t('faq.trialEnds.question')}
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              {t('faq.trialEnds.answer')}
            </p>
          </details>
          <details className="bg-white rounded-lg shadow px-4 py-3">
            <summary className="font-medium text-gray-900 cursor-pointer">
              {t('faq.refunds.question')}
            </summary>
            <p className="mt-2 text-sm text-gray-600">
              {t('faq.refunds.answer')}
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

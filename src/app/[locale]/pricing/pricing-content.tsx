'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { track, Events } from '@/lib/mixpanel';
import type { CurrencyCode } from '@/lib/plans';

type BillingInterval = 'monthly' | 'yearly';
type Tier = 'free' | 'pro' | 'enterprise';

interface PricingContentProps {
  locale: string;
  currency: CurrencyCode;
  proMonthly: number;
  proYearly: number;
  proMonthlyDisplay: string;
  proYearlyDisplay: string;
}

export function PricingContent({
  locale,
  currency,
  proMonthly,
  proYearly,
  proMonthlyDisplay,
  proYearlyDisplay,
}: PricingContentProps) {
  const t = useTranslations('pricingPage');
  const [interval, setInterval] = useState<BillingInterval>('monthly');

  useEffect(() => {
    track(Events.PRICING_VIEWED, { locale, currency });
  }, [locale, currency]);

  const handleTierSelect = (tier: Tier) => {
    track(Events.PRICING_TIER_SELECTED, { tier, interval, currency });
    if (tier === 'enterprise') {
      track(Events.PRICING_CONTACT_CLICKED, { source: 'pricing' });
      window.location.href = 'mailto:enterprise@aster-lang.dev?subject=Enterprise%20inquiry';
      return;
    }
    if (tier === 'pro') {
      track(Events.PRICING_CHECKOUT_STARTED, { plan: 'pro', interval, currency });
      void startProCheckout(interval, currency);
      return;
    }
    // free
    window.location.href = `/${locale}/signup`;
  };

  const proPriceDisplay = interval === 'monthly' ? proMonthlyDisplay : proYearlyDisplay;

  // JSON-LD：让搜索引擎抓到三档价格
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Aster Lang',
    description: t('seo.description'),
    offers: [
      { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: currency },
      {
        '@type': 'Offer',
        name: 'Pro',
        price: String(interval === 'monthly' ? proMonthly : proYearly),
        priceCurrency: currency,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          billingIncrement: interval === 'monthly' ? 'P1M' : 'P1Y',
        },
      },
      { '@type': 'Offer', name: 'Enterprise', price: '0', priceCurrency: currency, priceSpecification: { '@type': 'UnitPriceSpecification', valueAddedTaxIncluded: false } },
    ],
  };

  return (
    <main className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="mx-auto max-w-5xl px-4 pt-16 pb-8 text-center">
        <h1 className="text-4xl font-bold text-gray-900 sm:text-5xl">{t('hero.title')}</h1>
        <p className="mt-4 text-lg text-gray-600">{t('hero.subtitle')}</p>

        {/* monthly / yearly toggle */}
        <div className="mt-8 inline-flex rounded-full border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setInterval('monthly')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              interval === 'monthly' ? 'bg-white text-gray-900 shadow' : 'text-gray-500'
            }`}
          >
            {t('toggle.monthly')}
          </button>
          <button
            type="button"
            onClick={() => setInterval('yearly')}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              interval === 'yearly' ? 'bg-white text-gray-900 shadow' : 'text-gray-500'
            }`}
          >
            {t('toggle.yearly')}
          </button>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 pb-16 md:grid-cols-3">
        <TierCard
          name={t('tiers.free.name')}
          tagline={t('tiers.free.tagline')}
          priceLabel="0"
          priceSuffix={t('tiers.free.priceSuffix')}
          features={t.raw('tiers.free.features') as string[]}
          ctaLabel={t('tiers.free.cta')}
          onSelect={() => handleTierSelect('free')}
        />
        <TierCard
          highlighted
          highlightLabel={t('tiers.pro.highlight')}
          name={t('tiers.pro.name')}
          tagline={t('tiers.pro.tagline')}
          priceLabel={proPriceDisplay}
          priceSuffix={interval === 'yearly' ? t('tiers.pro.priceSuffixYearly') : t('tiers.pro.priceSuffix')}
          features={t.raw('tiers.pro.features') as string[]}
          ctaLabel={t('tiers.pro.cta')}
          onSelect={() => handleTierSelect('pro')}
        />
        <TierCard
          name={t('tiers.enterprise.name')}
          tagline={t('tiers.enterprise.tagline')}
          priceLabel={t('tiers.enterprise.priceSuffix')}
          features={t.raw('tiers.enterprise.features') as string[]}
          ctaLabel={t('tiers.enterprise.cta')}
          onSelect={() => handleTierSelect('enterprise')}
        />
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-24 text-center text-sm text-gray-500">
        <Link href={`/${locale}/signup`} className="text-indigo-600 hover:underline">
          {t('tiers.free.cta')} →
        </Link>
      </section>
    </main>
  );
}

interface TierCardProps {
  name: string;
  tagline: string;
  priceLabel: string;
  priceSuffix?: string;
  features: string[];
  ctaLabel: string;
  highlighted?: boolean;
  highlightLabel?: string;
  onSelect: () => void;
}

function TierCard({
  name,
  tagline,
  priceLabel,
  priceSuffix,
  features,
  ctaLabel,
  highlighted,
  highlightLabel,
  onSelect,
}: TierCardProps) {
  return (
    <div
      className={`relative flex flex-col rounded-xl border p-8 ${
        highlighted ? 'border-indigo-600 shadow-lg' : 'border-gray-200'
      }`}
    >
      {highlighted && highlightLabel && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white">
          {highlightLabel}
        </div>
      )}
      <h3 className="text-2xl font-bold text-gray-900">{name}</h3>
      <p className="mt-1 text-sm text-gray-500">{tagline}</p>
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-4xl font-bold text-gray-900">{priceLabel}</span>
        {priceSuffix && <span className="text-sm text-gray-500">{priceSuffix}</span>}
      </div>
      <ul className="mt-6 flex-1 space-y-2 text-sm text-gray-700">
        {features.map((feat) => (
          <li key={feat} className="flex items-start gap-2">
            <span aria-hidden>•</span>
            <span>{feat}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onSelect}
        className={`mt-6 rounded-md px-4 py-2 text-sm font-medium ${
          highlighted
            ? 'bg-indigo-600 text-white hover:bg-indigo-700'
            : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {ctaLabel}
      </button>
    </div>
  );
}

async function startProCheckout(interval: BillingInterval, currency: CurrencyCode) {
  try {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro', interval, currency, quantity: 1 }),
    });
    if (!res.ok) {
      console.error('[pricing] checkout failed', await res.text());
      return;
    }
    const { url } = (await res.json()) as { url?: string };
    if (url) {
      window.location.href = url;
    }
  } catch (err) {
    console.error('[pricing] checkout error', err);
  }
}

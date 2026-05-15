/**
 * Pricing page client.
 *
 * W2.2 rewrite — same behavior, design-system visuals:
 *   - Stripe checkout path unchanged (startProCheckout below)
 *   - Mixpanel tracking unchanged (PRICING_VIEWED, _TIER_SELECTED,
 *     _CHECKOUT_STARTED, _CONTACT_CLICKED)
 *   - monthly/yearly toggle now uses a token-driven segmented control
 *   - Tier cards use Card primitive; highlighted tier uses primary tone
 *   - All copy still routed through 'pricingPage' i18n namespace
 *
 * JSON-LD pricing offers preserved so SEO crawlers still see the three
 * tiers at their current displayed prices.
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { track, Events } from '@/lib/mixpanel';
import type { CurrencyCode } from '@/lib/plans';
import {
  buttonVariants,
  Card,
  CardHeader,
  CardBody,
  Container,
  Stack,
  cn,
} from '@/components/ui';

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
    // free tier
    window.location.href = `/${locale}/signup`;
  };

  const proPriceDisplay = interval === 'monthly' ? proMonthlyDisplay : proYearlyDisplay;

  // JSON-LD: keep crawlers seeing the three offers at their current prices.
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
      {
        '@type': 'Offer',
        name: 'Enterprise',
        price: '0',
        priceCurrency: currency,
        priceSpecification: { '@type': 'UnitPriceSpecification', valueAddedTaxIncluded: false },
      },
    ],
  };

  return (
    <main className="min-h-screen bg-bg text-fg">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Container size="xl" className="pt-16 pb-8">
        <Stack gap={8} align="center">
          <Stack gap={4} align="center" className="text-center">
            <h1 className="font-display text-5xl font-semibold leading-tight tracking-tight text-fg sm:text-6xl">
              {t('hero.title')}
            </h1>
            <p className="max-w-xl text-lg text-fg-muted">{t('hero.subtitle')}</p>
          </Stack>
          <IntervalToggle
            value={interval}
            onChange={setInterval}
            monthlyLabel={t('toggle.monthly')}
            yearlyLabel={t('toggle.yearly')}
          />
        </Stack>
      </Container>

      <Container size="xl" className="pb-16">
        <div className="grid gap-6 md:grid-cols-3">
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
            priceSuffix={
              interval === 'yearly'
                ? t('tiers.pro.priceSuffixYearly')
                : t('tiers.pro.priceSuffix')
            }
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
        </div>
      </Container>

      <Container size="base" className="pb-24 text-center">
        <Link
          href={`/${locale}/signup`}
          className="text-sm font-medium text-primary hover:text-primary-hover"
        >
          {t('tiers.free.cta')} →
        </Link>
      </Container>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Interval toggle (monthly / yearly)                                  */
/* ------------------------------------------------------------------ */

interface IntervalToggleProps {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
  monthlyLabel: string;
  yearlyLabel: string;
}

function IntervalToggle({ value, onChange, monthlyLabel, yearlyLabel }: IntervalToggleProps) {
  // Segmented control: a single rounded shell with two buttons. Active
  // pill uses bg-bg + shadow to look "raised" out of the bg-muted shell.
  return (
    <div
      role="tablist"
      aria-label="Billing interval"
      className="inline-flex rounded-full border border-border bg-bg-muted p-1"
    >
      <IntervalButton
        active={value === 'monthly'}
        onClick={() => onChange('monthly')}
        label={monthlyLabel}
      />
      <IntervalButton
        active={value === 'yearly'}
        onClick={() => onChange('yearly')}
        label={yearlyLabel}
      />
    </div>
  );
}

function IntervalButton({
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-4 py-1.5 text-sm font-medium',
        'transition-all duration-fast ease-standard',
        'focus-visible:outline-none focus-visible:shadow-ring',
        active
          ? 'bg-bg text-fg shadow-sm'
          : 'text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Tier card                                                           */
/* ------------------------------------------------------------------ */

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
  name, tagline, priceLabel, priceSuffix, features,
  ctaLabel, highlighted, highlightLabel, onSelect,
}: TierCardProps) {
  return (
    <Card className={cn(
      'relative flex flex-col',
      highlighted && 'border-2 border-primary shadow-lg shadow-primary/10',
    )}>
      {highlighted && highlightLabel && (
        <span className={cn(
          'absolute -top-3 left-1/2 -translate-x-1/2',
          'rounded-full bg-primary text-primary-fg',
          'px-3 py-1 text-xs font-semibold',
        )}>
          {highlightLabel}
        </span>
      )}
      <CardHeader>
        <h3 className="font-display text-2xl font-semibold tracking-tight text-fg">
          {name}
        </h3>
        <p className="text-sm text-fg-muted">{tagline}</p>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col gap-6">
        <p className="flex items-baseline gap-1.5">
          <span className="font-display text-4xl font-semibold tracking-tight text-fg">
            {priceLabel}
          </span>
          {priceSuffix && (
            <span className="text-sm text-fg-muted">{priceSuffix}</span>
          )}
        </p>
        <ul className="flex-1 space-y-3 text-sm text-fg-muted">
          {features.map((feat) => (
            <li key={feat} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>{feat}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onSelect}
          className={buttonVariants({
            variant: highlighted ? 'primary' : 'outline',
            size: 'md',
            className: 'mt-auto w-full',
          })}
        >
          {ctaLabel}
        </button>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Stripe checkout                                                     */
/* ------------------------------------------------------------------ */

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

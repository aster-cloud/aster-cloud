import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CAN_PRICING } from '@/lib/deployment-mode';
import {
  PUBLIC_PRO_MONTHLY_PRICE,
  getPublicCurrency,
  getAnnualAmount,
  formatPrice,
  type CurrencyCode,
} from '@/lib/plans';
import { PricingContent } from './pricing-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricingPage.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/pricing` },
  };
}

export default async function PricingPage({ params }: Props) {
  // On-prem 部署不公开定价表（enterprise license 协商定价）。
  if (!CAN_PRICING) {
    notFound();
  }

  const { locale } = await params;
  setRequestLocale(locale);

  // Per-request CSP nonce (x-nonce, set by middleware.ts). PricingContent is a
  // client component and can't read headers() itself, so the JSON-LD <script>'s
  // nonce must be threaded in from here, otherwise strict-dynamic CSP blocks it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  const currency: CurrencyCode = getPublicCurrency(locale);
  const proMonthly = PUBLIC_PRO_MONTHLY_PRICE[currency];
  const proYearly = getAnnualAmount(proMonthly);

  // JSON-LD Product schema for SEO（rendered in client component）
  const proMonthlyDisplay = formatPrice(proMonthly, currency);
  const proYearlyDisplay = formatPrice(proYearly, currency);

  return (
    <PricingContent
      locale={locale}
      currency={currency}
      proMonthly={proMonthly}
      proYearly={proYearly}
      proMonthlyDisplay={proMonthlyDisplay}
      proYearlyDisplay={proYearlyDisplay}
      nonce={nonce}
    />
  );
}

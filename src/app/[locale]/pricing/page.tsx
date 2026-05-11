import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
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
  const { locale } = await params;
  setRequestLocale(locale);

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
    />
  );
}

import { getTranslations, getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getUsageStats } from '@/lib/usage';
import { getCurrencyForLocale, PLANS, PlanType, CurrencyCode } from '@/lib/plans';
import { BillingContent } from './billing-content';

// FAQ item keys organized by category
const PRODUCT_FAQ_KEYS = [
  'whatIsAster',
  'whatIsPolicy',
  'piiDetection',
  'complianceStandards',
  'integration',
  'selfHosted',
] as const;

const BILLING_FAQ_KEYS = [
  'apiVsExecutions',
  'freeLimits',
  'upgradePlan',
  'downgrade',
  'trialEnds',
  'cancelAnytime',
  'refunds',
  'invoices',
  'dataSecurity',
  'support',
] as const;

export default async function BillingPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const t = await getTranslations('billing');
  const locale = await getLocale();
  const defaultCurrency = getCurrencyForLocale(locale) as CurrencyCode;

  // 获取用量统计
  const usageStats = await getUsageStats(session.user.id);

  // 序列化用量数据
  const initialUsage = {
    executions: usageStats.usage.executions,
    executionsLimit: usageStats.usage.executionsLimit,
    policies: usageStats.usage.policies,
    policiesLimit: usageStats.usage.policiesLimit,
    apiCalls: usageStats.usage.apiCalls,
    apiCallsLimit: usageStats.usage.apiCallsLimit,
  };

  // 获取当前计划和试用结束时间
  const currentPlan = (usageStats.plan || 'free') as PlanType;
  const trialEndsAt = session.user.trialEndsAt
    ? new Date(session.user.trialEndsAt).toISOString()
    : null;

  // 预渲染 Plan 名称
  const planNames: Record<string, string> = {};
  for (const planKey of Object.keys(PLANS)) {
    planNames[planKey] = t(`plans.names.${planKey}`);
  }

  // 预渲染 Plan 功能特性
  const planFeatures: Record<string, string> = {};
  const allFeatureKeys = new Set<string>();
  for (const planKey of Object.keys(PLANS)) {
    const plan = PLANS[planKey as PlanType];
    for (const featureKey of plan.featureKeys) {
      allFeatureKeys.add(featureKey);
    }
  }
  for (const featureKey of allFeatureKeys) {
    planFeatures[featureKey] = t(`plans.features.${featureKey}`);
  }

  // 预渲染 FAQ 项目
  const faqItems: Record<string, { question: string; answer: string }> = {};
  const allFaqKeys = [...PRODUCT_FAQ_KEYS, ...BILLING_FAQ_KEYS];
  for (const faqKey of allFaqKeys) {
    faqItems[faqKey] = {
      question: t(`faq.${faqKey}.question`),
      answer: t(`faq.${faqKey}.answer`),
    };
  }

  // 预渲染所有翻译字符串
  const translations = {
    title: t('title'),
    subtitle: t('subtitle'),
    subscriptionActivated: t('subscriptionActivated'),
    checkoutCanceled: t('checkoutCanceled'),
    currentPlan: t('currentPlan'),
    trialEndsTemplate: t.raw('trialEnds'),
    executionsThisMonth: t('executionsThisMonth'),
    apiCallsThisMonth: t('apiCallsThisMonth'),
    savedPolicies: t('savedPolicies'),
    monthly: t('monthly'),
    yearly: t('yearly'),
    save20: t('save20'),
    mostPopular: t('mostPopular'),
    contactSales: t('contactSales'),
    year: t('year'),
    month: t('month'),
    perUser: t('perUser'),
    teamUsers: t('teamUsers'),
    minUsersTemplate: t.raw('minUsers'),
    currentPlanButton: t('currentPlanButton'),
    loading: t('loading'),
    upgradeToTemplate: t.raw('upgradeTo'),
    freeTier: t('freeTier'),
    plans: {
      names: planNames,
      features: planFeatures,
    },
    faq: {
      title: t('faq.title'),
      productQuestions: t('faq.productQuestions'),
      billingQuestions: t('faq.billingQuestions'),
      items: faqItems,
    },
  };

  return (
    <BillingContent
      currentPlan={currentPlan}
      trialEndsAt={trialEndsAt}
      initialUsage={initialUsage}
      defaultCurrency={defaultCurrency}
      translations={translations}
    />
  );
}

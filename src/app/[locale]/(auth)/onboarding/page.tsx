import { getTranslations } from 'next-intl/server';
import { OnboardingContent } from './onboarding-content';

export default async function OnboardingPage() {
  const t = await getTranslations('auth.onboarding');
  const tNav = await getTranslations('nav');

  // 预渲染所有翻译字符串
  const translations = {
    brand: tNav('brand'),
    welcome: t('welcome'),
    industryQuestion: t('industryQuestion'),
    goalsQuestion: t('goalsQuestion'),
    continue: t('continue'),
    back: t('back'),
    starting: t('starting'),
    getStarted: t('getStarted'),
    skipForNow: t('skipForNow'),
    useCases: {
      finance: t('useCases.finance'),
      healthcare: t('useCases.healthcare'),
      ecommerce: t('useCases.ecommerce'),
      insurance: t('useCases.insurance'),
      legal: t('useCases.legal'),
      other: t('useCases.other'),
    },
    goals: {
      pii: t('goals.pii'),
      compliance: t('goals.compliance'),
      automation: t('goals.automation'),
      team: t('goals.team'),
      integration: t('goals.integration'),
    },
  };

  return <OnboardingContent translations={translations} />;
}

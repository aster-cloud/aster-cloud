import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DemoDashboardClient } from './client';

export default async function DemoDashboardPage() {
  const t = await getTranslations('demo.dashboard');

  const translations = {
    title: t('title'),
    subtitle: t('subtitle'),
    stats: {
      policies: t('stats.policies'),
      executions: t('stats.executions'),
      piiDetected: t('stats.piiDetected'),
      timeRemaining: t('stats.timeRemaining'),
    },
    quickActions: {
      title: t('quickActions.title'),
      createPolicy: t('quickActions.createPolicy'),
      createPolicyDesc: t('quickActions.createPolicyDesc'),
      executePolicy: t('quickActions.executePolicy'),
      executePolicyDesc: t('quickActions.executePolicyDesc'),
      viewExamples: t('quickActions.viewExamples'),
      viewExamplesDesc: t('quickActions.viewExamplesDesc'),
    },
    recentPolicies: {
      title: t('recentPolicies.title'),
      viewAll: t('recentPolicies.viewAll'),
      noPolicies: t('recentPolicies.noPolicies'),
      createFirst: t('recentPolicies.createFirst'),
    },
  };

  return <DemoDashboardClient translations={translations} />;
}

import { getTranslations } from 'next-intl/server';
import { DemoPoliciesClient } from './client';

export default async function DemoPoliciesPage() {
  const t = await getTranslations('demo.policies');

  const translations = {
    title: t('title'),
    subtitle: t('subtitle'),
    newPolicy: t('newPolicy'),
    noPolicies: t('noPolicies'),
    createFirst: t('createFirst'),
    loadExamples: t('loadExamples'),
    piiFields: t('piiFields'),
    executions: t('executions'),
    updated: t('updated'),
    policiesCount: t('policiesCount'),
    actions: {
      execute: t('actions.execute'),
      edit: t('actions.edit'),
      delete: t('actions.delete'),
    },
    confirmDelete: t('confirmDelete'),
    limitReached: t('limitReached'),
  };

  return <DemoPoliciesClient translations={translations} />;
}

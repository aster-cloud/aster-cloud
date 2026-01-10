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
    piiFields: t.raw('piiFields'),
    executions: t.raw('executions'),
    updated: t.raw('updated'),
    policiesCount: t.raw('policiesCount'),
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

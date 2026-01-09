import { getTranslations } from 'next-intl/server';
import { DemoExecuteClient } from './client';

export default async function DemoExecutePage() {
  const t = await getTranslations('demo.execute');

  const translations = {
    title: t('title'),
    subtitle: t('subtitle'),
    selectPolicy: t('selectPolicy'),
    noPolicies: t('noPolicies'),
    createFirst: t('createFirst'),
    input: t('input'),
    inputPlaceholder: t('inputPlaceholder'),
    execute: t('execute'),
    executing: t('executing'),
    result: t('result'),
    status: t('status'),
    success: t('success'),
    failed: t('failed'),
    duration: t('duration'),
    decision: t('decision'),
    matchedRules: t('matchedRules'),
    actions: t('actions'),
    error: t('error'),
    invalidJson: t('invalidJson'),
    examples: {
      loan: t('examples.loan'),
      user: t('examples.user'),
    },
  };

  return <DemoExecuteClient translations={translations} />;
}

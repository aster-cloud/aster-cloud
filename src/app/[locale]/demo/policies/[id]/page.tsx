import { getTranslations } from 'next-intl/server';
import { DemoPolicyDetailClient } from './client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DemoPolicyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const t = await getTranslations('demo.policies.detail');

  const translations = {
    backToList: t('backToList'),
    version: t('version'),
    executions: t('executions'),
    piiFields: t('piiFields'),
    piiWarning: t('piiWarning'),
    content: t('content'),
    versionHistory: t('versionHistory'),
    execute: t('execute'),
    edit: t('edit'),
    delete: t('delete'),
    confirmDelete: t('confirmDelete'),
    notFound: t('notFound'),
    loading: t('loading'),
  };

  return <DemoPolicyDetailClient policyId={id} translations={translations} />;
}

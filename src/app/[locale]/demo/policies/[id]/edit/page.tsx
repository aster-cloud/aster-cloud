import { getTranslations } from 'next-intl/server';
import { DemoPolicyEditClient } from './client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditDemoPolicyPage({ params }: PageProps) {
  const { id } = await params;
  const t = await getTranslations('demo.policies.form');

  const translations = {
    createTitle: t('createTitle'),
    createSubtitle: t('createSubtitle'),
    editTitle: t('editTitle'),
    editSubtitle: t('editSubtitle'),
    name: t('name'),
    namePlaceholder: t('namePlaceholder'),
    description: t('description'),
    descriptionPlaceholder: t('descriptionPlaceholder'),
    content: t('content'),
    contentPlaceholder: t('contentPlaceholder'),
    loadExample: t('loadExample'),
    cancel: t('cancel'),
    create: t('create'),
    creating: t('creating'),
    save: t('save'),
    saving: t('saving'),
    limitReached: t('limitReached'),
  };

  return <DemoPolicyEditClient policyId={id} translations={translations} />;
}

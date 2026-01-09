import { getTranslations, getLocale } from 'next-intl/server';
import { DemoPolicyFormClient } from '../form-client';

export default async function NewDemoPolicyPage() {
  const t = await getTranslations('demo.policies.form');
  const locale = await getLocale();

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

  return <DemoPolicyFormClient translations={translations} mode="create" locale={locale} />;
}

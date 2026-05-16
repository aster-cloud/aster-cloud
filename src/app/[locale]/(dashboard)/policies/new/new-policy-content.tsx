'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { PolicyForm } from '@/components/policy/policy-form';
import type { PolicyDraftFields } from '@/components/policy/policy-form/use-policy-draft';

/**
 * /policies/new — thin wrapper around <PolicyForm>.
 *
 * All UI lives in the shared PolicyForm component (IDE layout +
 * autosave + shortcuts). This wrapper only owns the create-specific
 * concerns: POST /api/policies on save, navigate to the new detail
 * page, surface upgrade prompts.
 */

interface NewPolicyContentProps {
  locale: string;
}

const EMPTY: PolicyDraftFields = {
  name: '',
  description: '',
  content: '',
  isPublic: false,
  groupId: null,
};

export function NewPolicyContent({ locale }: NewPolicyContentProps) {
  const t = useTranslations('policies');

  const handleSave = useCallback(
    async (fields: PolicyDraftFields) => {
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          message: data.message || data.error || t('form.failedToCreate'),
          upgrade: !!data.upgrade,
        };
      }
      return { id: data.id as string };
    },
    [t],
  );

  return (
    <PolicyForm
      mode="create"
      uiLocale={locale}
      policyId={null}
      initial={EMPTY}
      title={t('form.createTitle')}
      subtitle={t('form.createSubtitle')}
      onSave={handleSave}
      cancelHref={`/${locale}/policies`}
      detailHrefFor={(id) => `/${locale}/policies/${id}`}
      breadcrumbs={[
        { label: t('title'), href: '/policies' },
        { label: t('form.createTitle') },
      ]}
    />
  );
}

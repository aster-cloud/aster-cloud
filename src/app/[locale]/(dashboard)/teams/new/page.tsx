'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { Breadcrumbs } from '@/components/ui';
import { CLIENT_CAPABILITIES } from '@/hooks/use-deployment-mode';

export default function NewTeamPage() {
  const t = useTranslations('teams');
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
  });

  // 自动生成 slug
  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    setFormData({
      name,
      slug: generateSlug(name),
    });
  };

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setFormData((prev) => ({
      ...prev,
      slug,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.upgrade) {
          // SaaS: redirect to billing to upgrade. on-prem: no billing page,
          // surface the upgrade-required message as an inline error so the
          // operator knows to contact admin (team caps are license-driven).
          if (CLIENT_CAPABILITIES.billing) {
            router.push('/billing');
            return;
          }
          setError(t('upgradeRequired.contactAdmin'));
          return;
        }
        throw new Error(data.error || 'Failed to create team');
      }

      router.push(`/teams/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToCreate'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: t('backToTeams'), href: '/teams' },
            { label: t('createTeam.title') },
          ]}
        />
      </div>

      <div className="rounded-lg border border-border bg-bg shadow-sm">
        <div className="px-6 py-4 border-b border-border">
          <h1 className="font-display text-xl font-semibold tracking-tight text-fg">{t('createTeam.title')}</h1>
          <p className="mt-1 text-sm text-fg-muted">{t('createTeam.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-fg">
              {t('createTeam.nameLabel')}
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              minLength={2}
              maxLength={50}
              value={formData.name}
              onChange={handleNameChange}
              className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
              placeholder={t('createTeam.namePlaceholder')}
            />
            <p className="mt-1 text-xs text-fg-muted">{t('createTeam.nameHint')}</p>
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-fg">
              {t('createTeam.slugLabel')}
            </label>
            <div className="mt-1 flex rounded-md shadow-sm">
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-border-strong bg-bg-subtle px-3 text-fg-muted sm:text-sm">
                /teams/
              </span>
              <input
                type="text"
                id="slug"
                name="slug"
                required
                minLength={2}
                maxLength={50}
                pattern="[a-z0-9-]+"
                value={formData.slug}
                onChange={handleSlugChange}
                className="block w-full flex-1 rounded-none rounded-r-md border-border-strong focus:border-primary focus:ring-primary sm:text-sm"
                placeholder={t('createTeam.slugPlaceholder')}
              />
            </div>
            <p className="mt-1 text-xs text-fg-muted">{t('createTeam.slugHint')}</p>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-border">
            <Link
              href="/teams"
              className="inline-flex items-center rounded-md border border-border-strong bg-bg px-4 py-2 text-sm font-medium text-fg shadow-sm hover:bg-bg-subtle"
            >
              {t('cancel')}
            </Link>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t('creating')}
                </>
              ) : (
                t('createTeam.submitButton')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

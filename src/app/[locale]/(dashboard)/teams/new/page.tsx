'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

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
          router.push('/billing');
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
        <Link
          href="/teams"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('backToTeams')}
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h1 className="text-xl font-semibold text-gray-900">{t('createTeam.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('createTeam.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
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
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              placeholder={t('createTeam.namePlaceholder')}
            />
            <p className="mt-1 text-xs text-gray-500">{t('createTeam.nameHint')}</p>
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-gray-700">
              {t('createTeam.slugLabel')}
            </label>
            <div className="mt-1 flex rounded-md shadow-sm">
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 px-3 text-gray-500 sm:text-sm">
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
                className="block w-full flex-1 rounded-none rounded-r-md border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                placeholder={t('createTeam.slugPlaceholder')}
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">{t('createTeam.slugHint')}</p>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <Link
              href="/teams"
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              {t('cancel')}
            </Link>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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

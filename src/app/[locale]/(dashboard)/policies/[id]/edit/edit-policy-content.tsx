'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useLocale } from 'next-intl';

// 动态导入 Monaco 编辑器以避免 SSR 问题
const MonacoPolicyEditor = dynamic(
  () => import('@/components/policy/monaco-policy-editor').then((mod) => mod.MonacoPolicyEditor),
  {
    ssr: false,
    loading: () => (
      <div className="h-[400px] bg-gray-900 rounded-lg flex items-center justify-center text-gray-400">
        Loading editor...
      </div>
    ),
  }
);

interface Policy {
  id: string;
  name: string;
  description: string | null;
  content: string;
  isPublic: boolean;
}

interface Translations {
  form: {
    editTitle: string;
    editSubtitle: string;
    name: string;
    namePlaceholder: string;
    description: string;
    descriptionPlaceholder: string;
    content: string;
    contentPlaceholder: string;
    contentHelp: string;
    isPublic: string;
    cancel: string;
    save: string;
    saving: string;
    failedToUpdate: string;
  };
}

interface EditPolicyContentProps {
  policy: Policy;
  translations: Translations;
}

export function EditPolicyContent({
  policy,
  translations: t,
}: EditPolicyContentProps) {
  const router = useRouter();
  const locale = useLocale();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description || '');
  const [content, setContent] = useState(policy.content);
  const [isPublic, setIsPublic] = useState(policy.isPublic);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');

    try {
      const res = await fetch(`/api/policies/${policy.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, content, isPublic }),
      });

      if (!res.ok) {
        const data = await res.json();
        // 优先显示详细消息，支持冻结场景
        const errorMessage = data.message || data.error || t.form.failedToUpdate;
        if (data.upgrade || data.frozen) {
          setError(`${errorMessage}|UPGRADE`);
        } else {
          setError(errorMessage);
        }
        return;
      }

      router.push(`/${locale}/policies/${policy.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.form.failedToUpdate);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div>
          <div className="flex items-center">
            <Link href={`/${locale}/policies/${policy.id}`} className="text-gray-400 hover:text-gray-600 mr-2">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">{t.form.editTitle}</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {t.form.editSubtitle}
          </p>
        </div>
      </div>

      {error && (() => {
        const needsUpgrade = error.includes('|UPGRADE');
        const displayError = error.replace('|UPGRADE', '');
        return (
          <div className="mb-6 rounded-md bg-red-50 p-4">
            <p className="text-sm text-red-700">{displayError}</p>
            {needsUpgrade && (
              <Link
                href={`/${locale}/billing`}
                className="mt-2 inline-block text-sm font-medium text-red-700 underline"
              >
                Upgrade your plan
              </Link>
            )}
          </div>
        );
      })()}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white shadow-lg sm:rounded-xl border border-gray-200">
          <div className="px-6 py-6 sm:p-8">
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-gray-900">
                {t.form.name}
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm"
                placeholder={t.form.namePlaceholder}
              />
            </div>

            {/* Description */}
            <div className="mt-6">
              <label htmlFor="description" className="block text-sm font-semibold text-gray-900">
                {t.form.description}
              </label>
              <input
                type="text"
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm"
                placeholder={t.form.descriptionPlaceholder}
              />
            </div>

            {/* Content - Monaco Editor */}
            <div className="mt-6">
              <label htmlFor="content" className="block text-sm font-semibold text-gray-900">
                {t.form.content}
              </label>
              <div className="mt-2">
                <MonacoPolicyEditor
                  value={content}
                  onChange={setContent}
                  locale={locale}
                  height="400px"
                  placeholder={t.form.contentPlaceholder}
                />
              </div>
              <p className="mt-3 text-sm text-gray-500">
                {t.form.contentHelp}
              </p>
            </div>

            {/* Public toggle */}
            <div className="mt-6 flex items-center">
              <input
                id="isPublic"
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
              />
              <label htmlFor="isPublic" className="ml-3 block text-sm font-medium text-gray-700 cursor-pointer">
                {t.form.isPublic}
              </label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-4">
          <Link
            href={`/${locale}/policies/${policy.id}`}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-400"
          >
            {t.form.cancel}
          </Link>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex justify-center rounded-lg border border-transparent bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? t.form.saving : t.form.save}
          </button>
        </div>
      </form>
    </div>
  );
}

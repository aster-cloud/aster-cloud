'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { ASTER_POLICY_TEMPLATES } from '@/config/aster-policy-templates';

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

interface NewPolicyContentProps {
  locale: string;
}

export function NewPolicyContent({ locale }: NewPolicyContentProps) {
  const t = useTranslations('policies');
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, content, isPublic }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.upgrade) {
          setError(data.message);
        } else {
          throw new Error(data.error || t('form.failedToCreate'));
        }
        return;
      }

      router.push(`/${locale}/policies/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('form.failedToCreate'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadExample = () => {
    setName(t('example.name'));
    setDescription(t('example.description'));
    // 根据当前语言加载对应的示例模板（支持 zh、zh-CN、zh-Hans 等）
    const templateKey = locale.startsWith('zh') ? 'zh-CN' : 'en-US';
    setContent(ASTER_POLICY_TEMPLATES[templateKey as keyof typeof ASTER_POLICY_TEMPLATES]);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('form.createTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('form.createSubtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={loadExample}
          className="mt-4 md:mt-0 text-sm text-indigo-600 hover:text-indigo-500"
        >
          {t('form.loadExample')}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          {error.includes('Upgrade') && (
            <Link
              href={`/${locale}/billing`}
              className="mt-2 inline-block text-sm font-medium text-red-700 underline"
            >
              {t('form.viewPlans')}
            </Link>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white shadow-lg sm:rounded-xl border border-gray-200">
          <div className="px-6 py-6 sm:p-8">
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-semibold text-gray-900">
                {t('form.name')}
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm"
                placeholder={t('form.namePlaceholder')}
              />
            </div>

            {/* Description */}
            <div className="mt-6">
              <label htmlFor="description" className="block text-sm font-semibold text-gray-900">
                {t('form.description')}
              </label>
              <input
                type="text"
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm"
                placeholder={t('form.descriptionPlaceholder')}
              />
            </div>

            {/* Content - Monaco Editor */}
            <div className="mt-6">
              <label htmlFor="content" className="block text-sm font-semibold text-gray-900">
                {t('form.content')}
              </label>
              <div className="mt-2">
                <MonacoPolicyEditor
                  value={content}
                  onChange={setContent}
                  locale={locale}
                  height="400px"
                  placeholder={t('form.contentPlaceholder')}
                />
              </div>
              <p className="mt-3 text-sm text-gray-500">
                {t('form.contentHelp')}
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
                {t('form.isPublic')}
              </label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-4">
          <Link
            href={`/${locale}/policies`}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:border-gray-400"
          >
            {t('form.cancel')}
          </Link>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex justify-center rounded-lg border border-transparent bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-200 hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? t('form.creating') : t('form.create')}
          </button>
        </div>
      </form>
    </div>
  );
}

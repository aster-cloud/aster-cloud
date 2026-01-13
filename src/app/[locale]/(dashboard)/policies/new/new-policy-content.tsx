'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import {
  POLICY_EXAMPLES,
  CATEGORY_LABELS,
  type PolicyExample,
  getExampleName,
  getExampleDescription,
  getExampleSource,
  normalizeLocale,
} from '@/data/policy-examples';
import { PolicyGroupSelect } from '@/components/policy/policy-group-select';
import { CNLSyntaxReferencePanel } from '@/components/policy/cnl-syntax-reference-panel';
import { CNLSyntaxConverterDialog, CNLConvertButton } from '@/components/policy/cnl-syntax-converter-dialog';

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
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // CNL 语言跟随页面 locale
  const cnlLocale = normalizeLocale(locale);

  // 示例选择器状态
  const [selectedExample, setSelectedExample] = useState<PolicyExample | null>(null);
  const [showExampleSelector, setShowExampleSelector] = useState(false);

  // 语法转换对话框状态
  const [isConverterOpen, setIsConverterOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, content, isPublic, groupId }),
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

  // 选择示例策略作为模板
  const handleSelectExample = useCallback(
    (example: PolicyExample) => {
      setSelectedExample(example);
      setShowExampleSelector(false);
      setName(getExampleName(example, locale));
      setDescription(getExampleDescription(example, locale));
      // 使用当前页面语言获取对应的源码
      setContent(getExampleSource(example, normalizeLocale(locale)));
    },
    [locale]
  );

  // 应用语法转换结果
  const handleApplyConversion = useCallback((convertedContent: string, _newLocale: unknown) => {
    void _newLocale; // CNL 语言已跟随页面 locale，忽略转换后的语言
    setContent(convertedContent);
    // 转换后清除模板选择状态，因为内容已经被修改
    setSelectedExample(null);
  }, []);

  // 清除选中的示例
  const handleClearExample = useCallback(() => {
    setSelectedExample(null);
    setName('');
    setDescription('');
    setContent('');
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('form.createTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('form.createSubtitle')}
          </p>
        </div>
      </div>

      {/* 示例策略选择器 + CNL 语言选择器 */}
      <div className="mb-6 bg-white shadow-sm sm:rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">
              {locale.startsWith('zh') ? '从示例开始：' : 'Start from example:'}
            </span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExampleSelector(!showExampleSelector)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {selectedExample
                  ? getExampleName(selectedExample, locale)
                  : locale.startsWith('zh')
                    ? '选择示例模板...'
                    : 'Choose a template...'}
                <svg
                  className={`h-4 w-4 transition-transform ${showExampleSelector ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* 下拉菜单 */}
              {showExampleSelector && (
                <div className="absolute z-10 mt-2 w-80 origin-top-left rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                  <div className="py-1 max-h-96 overflow-y-auto">
                    {/* 按类别分组显示 */}
                    {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((category) => {
                      const categoryExamples = POLICY_EXAMPLES.filter((e) => e.category === category);
                      if (categoryExamples.length === 0) return null;
                      return (
                        <div key={category}>
                          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                            {CATEGORY_LABELS[category][normalizeLocale(locale)]}
                          </div>
                          {categoryExamples.map((example) => (
                            <button
                              key={example.id}
                              type="button"
                              onClick={() => handleSelectExample(example)}
                              className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 ${
                                selectedExample?.id === example.id ? 'bg-indigo-100 text-indigo-900' : 'text-gray-700'
                              }`}
                            >
                              <div className="font-medium">{getExampleName(example, locale)}</div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {getExampleDescription(example, locale)}
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 语法转换按钮（仅在有内容且非模板模式时显示） */}
            {!selectedExample && content.trim() && (
              <CNLConvertButton
                onClick={() => setIsConverterOpen(true)}
                uiLocale={locale}
              />
            )}

            {/* 清除选择按钮 */}
            {selectedExample && (
              <button
                type="button"
                onClick={handleClearExample}
                className="text-sm text-gray-500 hover:text-gray-700 font-medium flex items-center gap-1"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                {locale.startsWith('zh') ? '清除' : 'Clear'}
              </button>
            )}
          </div>
        </div>

        {/* 已选示例提示 */}
        {selectedExample && (
          <div className="mt-3 p-3 rounded-lg bg-indigo-50 border border-indigo-100">
            <div className="flex items-start gap-2">
              <svg className="h-5 w-5 text-indigo-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-indigo-700">
                {locale.startsWith('zh')
                  ? '已加载示例模板。你可以修改后保存为你的策略。'
                  : 'Template loaded. You can modify and save as your policy.'}
              </div>
            </div>
          </div>
        )}
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
                name="name"
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
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder-gray-400 shadow-sm transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none hover:border-gray-400 sm:text-sm"
                placeholder={t('form.descriptionPlaceholder')}
              />
            </div>

            {/* Group */}
            <div className="mt-6">
              <PolicyGroupSelect
                value={groupId}
                onChange={setGroupId}
                label={locale.startsWith('zh') ? '分组' : 'Group'}
                placeholder={locale.startsWith('zh') ? '选择分组（可选）...' : 'Select a group (optional)...'}
              />
              <p className="mt-2 text-sm text-gray-500">
                {locale.startsWith('zh')
                  ? '可选：将策略归类到一个分组以便管理'
                  : 'Optional: Organize your policy into a group for better management'}
              </p>
            </div>

            {/* Content - Monaco Editor */}
            <div className="mt-6">
              <label id="content-label" className="block text-sm font-semibold text-gray-900">
                {t('form.content')}
              </label>
              <div className="mt-2" role="group" aria-labelledby="content-label">
                <MonacoPolicyEditor
                  value={content}
                  onChange={setContent}
                  locale={cnlLocale}
                  height="400px"
                  placeholder={t('form.contentPlaceholder')}
                  enableLSP={true}
                />
              </div>
              <p className="mt-3 text-sm text-gray-500">
                {t('form.contentHelp')}
              </p>

              {/* 语法参考面板 */}
              <CNLSyntaxReferencePanel
                locale={cnlLocale}
                uiLocale={locale}
                className="mt-4"
                defaultExpanded={false}
              />
            </div>

            {/* Public toggle */}
            <div className="mt-6 flex items-center">
              <input
                id="isPublic"
                name="isPublic"
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

      {/* 语法转换对话框 */}
      <CNLSyntaxConverterDialog
        isOpen={isConverterOpen}
        onClose={() => setIsConverterOpen(false)}
        content={content}
        currentLocale={cnlLocale}
        uiLocale={locale}
        onApply={handleApplyConversion}
      />
    </div>
  );
}

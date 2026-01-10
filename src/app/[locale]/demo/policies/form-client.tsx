'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useDemoSession } from '@/components/demo';
import { createDemoPolicy } from '@/lib/demo-api';
import {
  POLICY_EXAMPLES,
  getExampleName,
  getExampleDescription,
  getCategoryLabel,
  POLICY_EXAMPLES_BY_LOCALE,
  type PolicyExample,
} from '@/data/policy-examples';

interface DemoPolicyFormClientProps {
  translations: {
    createTitle: string;
    createSubtitle: string;
    editTitle: string;
    editSubtitle: string;
    name: string;
    namePlaceholder: string;
    description: string;
    descriptionPlaceholder: string;
    content: string;
    contentPlaceholder: string;
    loadExample: string;
    cancel: string;
    create: string;
    creating: string;
    save: string;
    saving: string;
    limitReached: string;
  };
  mode: 'create' | 'edit';
  policyId?: string;
  initialData?: {
    name: string;
    description: string;
    content: string;
  };
  locale?: string;
}

export function DemoPolicyFormClient({
  translations: t,
  mode,
  policyId,
  initialData,
  locale = 'en',
}: DemoPolicyFormClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { limits, refreshSession } = useDemoSession();

  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [content, setContent] = useState(initialData?.content || '');
  const [defaultInput, setDefaultInput] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 根据 UI 语言获取策略示例列表（优先显示匹配语言的示例）
  const sortedExamples = useMemo(() => {
    const policyLocale = locale.startsWith('zh') ? 'zh-CN' : locale.startsWith('de') ? 'de-DE' : 'en-US';
    const matchingExamples = POLICY_EXAMPLES_BY_LOCALE[policyLocale] || [];
    const otherExamples = POLICY_EXAMPLES.filter((e) => e.locale !== policyLocale);
    return [...matchingExamples, ...otherExamples];
  }, [locale]);

  // 加载示例策略
  useEffect(() => {
    const exampleKey = searchParams.get('example');
    if (exampleKey && mode === 'create') {
      // 首先尝试找到匹配当前语言的示例
      const policyLocale = locale.startsWith('zh') ? 'zh-CN' : locale.startsWith('de') ? 'de-DE' : 'en-US';
      let example = POLICY_EXAMPLES.find((e) => e.id === exampleKey && e.locale === policyLocale);
      // 如果没有匹配语言的，则查找任意匹配的示例
      if (!example) {
        example = POLICY_EXAMPLES.find((e) => e.id === exampleKey || e.category === exampleKey);
      }
      if (example) {
        setName(getExampleName(example, locale));
        setDescription(getExampleDescription(example, locale));
        setContent(example.source);
        setDefaultInput(example.defaultInput as Record<string, unknown>);
      }
    }
  }, [searchParams, mode, locale]);

  const canCreate =
    mode === 'edit' ||
    (limits ? limits.policies.current < limits.policies.max : true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;

    setSaving(true);
    setError(null);

    try {
      const response = await createDemoPolicy({
        name,
        description,
        content,
        defaultInput: defaultInput || undefined,
      });

      if (response.success && response.data) {
        refreshSession();
        router.push(`/demo/policies/${response.data.id}`);
      } else {
        setError(response.error || 'Failed to create policy');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create policy');
    } finally {
      setSaving(false);
    }
  };

  const loadExample = (exampleId: string) => {
    const example = POLICY_EXAMPLES.find((e) => e.id === exampleId);
    if (example) {
      setName(getExampleName(example, locale));
      setDescription(getExampleDescription(example, locale));
      setContent(example.source);
      setDefaultInput(example.defaultInput as Record<string, unknown>);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {mode === 'create' ? t.createTitle : t.editTitle}
        </h1>
        <p className="text-gray-600 mt-1">
          {mode === 'create' ? t.createSubtitle : t.editSubtitle}
        </p>
      </div>

      {!canCreate && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-amber-800">{t.limitReached}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Example Selector */}
        {mode === 'create' && (
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">{t.loadExample}:</span>
            <select
              onChange={(e) => loadExample(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1"
              defaultValue=""
            >
              <option value="" disabled>
                Select...
              </option>
              {sortedExamples.map((example) => (
                <option key={example.id} value={example.id}>
                  {getExampleName(example, locale)} ({getCategoryLabel(example.category, locale)})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Name */}
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700"
          >
            {t.name}
          </label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700"
          >
            {t.description}
          </label>
          <input
            type="text"
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.descriptionPlaceholder}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
        </div>

        {/* Content */}
        <div>
          <label
            htmlFor="content"
            className="block text-sm font-medium text-gray-700"
          >
            {t.content}
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t.contentPlaceholder}
            required
            rows={15}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 font-mono text-sm"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end space-x-4">
          <Link
            href="/demo/policies"
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            {t.cancel}
          </Link>
          <button
            type="submit"
            disabled={saving || !canCreate}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving
              ? mode === 'create'
                ? t.creating
                : t.saving
              : mode === 'create'
                ? t.create
                : t.save}
          </button>
        </div>
      </form>
    </div>
  );
}

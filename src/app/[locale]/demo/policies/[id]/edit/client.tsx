'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useDemoSession } from '@/components/demo';
import { getMockPolicy } from '@/data/demo-mock-data';

interface DemoPolicyEditClientProps {
  policyId: string;
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
}

export function DemoPolicyEditClient({
  policyId,
  translations: t,
}: DemoPolicyEditClientProps) {
  const router = useRouter();
  const { refreshSession } = useDemoSession();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载现有策略数据（使用模拟数据）
  useEffect(() => {
    // 模拟短暂加载延迟
    const timer = setTimeout(() => {
      const mockPolicy = getMockPolicy(policyId);
      if (mockPolicy) {
        setName(mockPolicy.name);
        setDescription(mockPolicy.description || '');
        setContent(mockPolicy.content);
      } else {
        setError('Policy not found');
      }
      setLoading(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [policyId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    setSaving(true);
    setError(null);

    // 模拟保存延迟
    setTimeout(() => {
      // Demo 模式下只是模拟保存成功
      refreshSession();
      router.push(`/demo/policies/${policyId}`);
      setSaving(false);
    }, 300);
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
        <div className="h-64 bg-gray-200 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (error && !name) {
    return (
      <div className="max-w-3xl mx-auto text-center py-12">
        <p className="text-gray-500 mb-4">{error}</p>
        <Link
          href="/demo/policies"
          className="text-indigo-600 hover:text-indigo-800"
        >
          Back to policies
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t.editTitle}</h1>
        <p className="text-gray-600 mt-1">{t.editSubtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
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
            href={`/demo/policies/${policyId}`}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            {t.cancel}
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? t.saving : t.save}
          </button>
        </div>
      </form>
    </div>
  );
}

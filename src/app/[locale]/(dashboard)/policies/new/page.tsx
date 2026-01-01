'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const EXAMPLE_POLICY = `// Loan Approval Policy
// Rules for evaluating loan applications

if creditScore >= 750 then approve with premium rate
if creditScore >= 650 then approve with standard rate
if creditScore < 650 then require manual review
if income >= 100000 then increase limit by 20%
if debtToIncomeRatio > 0.4 then reject application`;

export default function NewPolicyPage() {
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
          throw new Error(data.error || 'Failed to create policy');
        }
        return;
      }

      router.push(`/policies/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create policy');
    } finally {
      setIsLoading(false);
    }
  };

  const loadExample = () => {
    setName('Loan Approval Policy');
    setDescription('Rules for evaluating loan applications based on credit score and income');
    setContent(EXAMPLE_POLICY);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="md:flex md:items-center md:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create New Policy</h1>
          <p className="mt-1 text-sm text-gray-500">
            Define your business rules using Aster policy language
          </p>
        </div>
        <button
          type="button"
          onClick={loadExample}
          className="mt-4 md:mt-0 text-sm text-indigo-600 hover:text-indigo-500"
        >
          Load example
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          {error.includes('Upgrade') && (
            <Link
              href="/billing"
              className="mt-2 inline-block text-sm font-medium text-red-700 underline"
            >
              View plans
            </Link>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Policy Name
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                placeholder="e.g., Loan Approval Policy"
              />
            </div>

            {/* Description */}
            <div className="mt-4">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                Description (optional)
              </label>
              <input
                type="text"
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                placeholder="Brief description of what this policy does"
              />
            </div>

            {/* Content */}
            <div className="mt-4">
              <label htmlFor="content" className="block text-sm font-medium text-gray-700">
                Policy Content
              </label>
              <div className="mt-1">
                <textarea
                  id="content"
                  rows={15}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  required
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono"
                  placeholder="// Write your policy rules here..."
                />
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Use Aster policy syntax. Format: if [field] [condition] [value] then [action]
              </p>
            </div>

            {/* Public toggle */}
            <div className="mt-4 flex items-center">
              <input
                id="isPublic"
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="isPublic" className="ml-2 block text-sm text-gray-700">
                Make this policy public (shareable via link)
              </label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3">
          <Link
            href="/policies"
            className="rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {isLoading ? 'Creating...' : 'Create Policy'}
          </button>
        </div>
      </form>
    </div>
  );
}

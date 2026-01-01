'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export default function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      const response = await fetch('/api/keys');
      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.keys || []);
      }
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      setError('Please enter a name for your API key');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create API key');
      }

      const data = await response.json();
      setNewKeyValue(data.key);
      setNewKeyName('');
      fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/keys/${keyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to revoke API key');
      }

      fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <nav className="text-sm text-gray-500 mb-2">
            <Link href="/settings" className="hover:text-gray-700">Settings</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900">API Keys</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage API keys for programmatic access to Aster Cloud.
          </p>
        </div>
      </div>

      {/* New Key Created Alert */}
      {newKeyValue && (
        <div className="rounded-md bg-green-50 p-4 border border-green-200">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-green-800">API Key Created</h3>
              <p className="mt-1 text-sm text-green-700">
                Copy your API key now. You won&apos;t be able to see it again!
              </p>
              <div className="mt-2 flex items-center space-x-2">
                <code className="flex-1 bg-green-100 px-3 py-2 rounded text-sm font-mono text-green-900 break-all">
                  {newKeyValue}
                </code>
                <button
                  onClick={() => copyToClipboard(newKeyValue)}
                  className="px-3 py-2 text-sm font-medium text-green-700 bg-green-100 rounded hover:bg-green-200"
                >
                  Copy
                </button>
              </div>
              <button
                onClick={() => setNewKeyValue(null)}
                className="mt-2 text-sm text-green-600 hover:text-green-800"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Create New Key */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Create New API Key</h3>
          <form onSubmit={handleCreateKey} className="mt-4 flex space-x-4">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name (e.g., Production, Development)"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            <button
              type="submit"
              disabled={isCreating}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {isCreating ? 'Creating...' : 'Create Key'}
            </button>
          </form>
        </div>
      </div>

      {/* API Keys List */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Your API Keys</h3>
          {isLoading ? (
            <div className="mt-4 text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="mt-4 text-center py-8 text-gray-500">
              No API keys yet. Create one above to get started.
            </div>
          ) : (
            <div className="mt-4 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Key
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Last Used
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td className="px-3 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {key.name}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                        {key.prefix}...
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">
                        {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-right text-sm">
                        <button
                          onClick={() => handleRevokeKey(key.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Usage Example */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">Usage Example</h3>
          <pre className="mt-4 bg-gray-900 text-gray-100 p-4 rounded-md overflow-x-auto text-sm">
{`curl -X POST https://aster-lang.cloud/api/execute \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"policyId": "...", "input": {...}}'`}
          </pre>
        </div>
      </div>
    </div>
  );
}

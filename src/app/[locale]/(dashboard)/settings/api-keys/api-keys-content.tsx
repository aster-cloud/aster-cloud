'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface Translations {
  breadcrumb: string;
  title: string;
  subtitle: string;
  keyCreated: string;
  copyWarning: string;
  copy: string;
  dismiss: string;
  createNew: string;
  keyPlaceholder: string;
  creating: string;
  createKey: string;
  enterName: string;
  confirmRevoke: string;
  yourKeys: string;
  noKeys: string;
  name: string;
  key: string;
  lastUsed: string;
  created: string;
  actions: string;
  never: string;
  revoke: string;
  usageExample: string;
  usageDescription: string;
  examples: {
    getPolicyId: string;
    getPolicyIdDesc: string;
    executePolicy: string;
    executePolicyDesc: string;
    listPolicies: string;
    listPoliciesDesc: string;
    responseExample: string;
    responseExampleDesc: string;
    errorHandling: string;
    errorHandlingDesc: string;
    error401: string;
    error403: string;
    error404: string;
    error429: string;
  };
  nav: {
    settings: string;
  };
}

interface ApiKeysContentProps {
  initialApiKeys: ApiKey[];
  translations: Translations;
}

export function ApiKeysContent({
  initialApiKeys,
  translations: t,
}: ApiKeysContentProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(initialApiKeys);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchApiKeys = async () => {
    try {
      const response = await fetch('/api/api-keys');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to fetch API keys');
      }

      const data = await response.json();
      const normalized = Array.isArray(data)
        ? data
        : (data as { keys?: ApiKey[] }).keys || [];
      setApiKeys(normalized);
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch API keys');
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      setError(t.enterName);
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to create API key');
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
    if (!confirm(t.confirmRevoke)) {
      return;
    }

    try {
      const response = await fetch(`/api/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to revoke API key');
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
            <Link href="/settings" className="hover:text-gray-700">{t.nav.settings}</Link>
            <span className="mx-2">/</span>
            <span className="text-gray-900">{t.breadcrumb}</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t.subtitle}
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
              <h3 className="text-sm font-medium text-green-800">{t.keyCreated}</h3>
              <p className="mt-1 text-sm text-green-700">
                {t.copyWarning}
              </p>
              <div className="mt-2 flex items-center space-x-2">
                <code className="flex-1 bg-green-100 px-3 py-2 rounded text-sm font-mono text-green-900 break-all">
                  {newKeyValue}
                </code>
                <button
                  onClick={() => copyToClipboard(newKeyValue)}
                  className="px-3 py-2 text-sm font-medium text-green-700 bg-green-100 rounded hover:bg-green-200"
                >
                  {t.copy}
                </button>
              </div>
              <button
                onClick={() => setNewKeyValue(null)}
                className="mt-2 text-sm text-green-600 hover:text-green-800"
              >
                {t.dismiss}
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
          <label htmlFor="apiKeyName" className="text-lg font-medium leading-6 text-gray-900">{t.createNew}</label>
          <form onSubmit={handleCreateKey} className="mt-4 flex space-x-4">
            <input
              type="text"
              id="apiKeyName"
              name="apiKeyName"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t.keyPlaceholder}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
            <button
              type="submit"
              disabled={isCreating}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {isCreating ? t.creating : t.createKey}
            </button>
          </form>
        </div>
      </div>

      {/* API Keys List */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">{t.yourKeys}</h3>
          {apiKeys.length === 0 ? (
            <div className="mt-4 text-center py-8 text-gray-500">
              {t.noKeys}
            </div>
          ) : (
            <div className="mt-4 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t.name}
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t.key}
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t.lastUsed}
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t.created}
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {t.actions}
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
                        {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : t.never}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-right text-sm">
                        <button
                          onClick={() => handleRevokeKey(key.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          {t.revoke}
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

      {/* Usage Examples */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900">{t.usageExample}</h3>
          <p className="mt-1 text-sm text-gray-500">{t.usageDescription}</p>

          {/* How to get Policy ID */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-md p-4">
            <h4 className="text-sm font-medium text-blue-900">{t.examples.getPolicyId}</h4>
            <p className="mt-1 text-xs text-blue-700">{t.examples.getPolicyIdDesc}</p>
          </div>

          {/* Execute Policy */}
          <div className="mt-6">
            <h4 className="text-sm font-medium text-gray-900">{t.examples.executePolicy}</h4>
            <p className="mt-1 text-xs text-gray-500">{t.examples.executePolicyDesc}</p>

            {/* cURL */}
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase">cURL</span>
                <button
                  onClick={() => copyToClipboard(`curl -X POST https://aster-lang.cloud/api/v1/policies/YOUR_POLICY_ID/execute \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": {
      "creditScore": 750,
      "income": 85000,
      "loanAmount": 250000
    }
  }'`)}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  {t.copy}
                </button>
              </div>
              <pre className="mt-1 bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto text-xs">
{`curl -X POST https://aster-lang.cloud/api/v1/policies/YOUR_POLICY_ID/execute \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": {
      "creditScore": 750,
      "income": 85000,
      "loanAmount": 250000
    }
  }'`}
              </pre>
            </div>

            {/* JavaScript/Node.js */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase">JavaScript / Node.js</span>
                <button
                  onClick={() => copyToClipboard(`const policyId = 'YOUR_POLICY_ID';

const response = await fetch(\`https://aster-lang.cloud/api/v1/policies/\${policyId}/execute\`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    input: {
      creditScore: 750,
      income: 85000,
      loanAmount: 250000,
    },
  }),
});

const result = await response.json();
console.log(result.success ? 'Approved' : 'Rejected');`)}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  {t.copy}
                </button>
              </div>
              <pre className="mt-1 bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto text-xs">
{`const policyId = 'YOUR_POLICY_ID';

const response = await fetch(\`https://aster-lang.cloud/api/v1/policies/\${policyId}/execute\`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    input: {
      creditScore: 750,
      income: 85000,
      loanAmount: 250000,
    },
  }),
});

const result = await response.json();
console.log(result.success ? 'Approved' : 'Rejected');`}
              </pre>
            </div>

            {/* Python */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase">Python</span>
                <button
                  onClick={() => copyToClipboard(`import requests

policy_id = 'YOUR_POLICY_ID'

response = requests.post(
    f'https://aster-lang.cloud/api/v1/policies/{policy_id}/execute',
    headers={
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json',
    },
    json={
        'input': {
            'creditScore': 750,
            'income': 85000,
            'loanAmount': 250000,
        },
    },
)

result = response.json()
print('Approved' if result['success'] else 'Rejected')`)}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  {t.copy}
                </button>
              </div>
              <pre className="mt-1 bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto text-xs">
{`import requests

policy_id = 'YOUR_POLICY_ID'

response = requests.post(
    f'https://aster-lang.cloud/api/v1/policies/{policy_id}/execute',
    headers={
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json',
    },
    json={
        'input': {
            'creditScore': 750,
            'income': 85000,
            'loanAmount': 250000,
        },
    },
)

result = response.json()
print('Approved' if result['success'] else 'Rejected')`}
              </pre>
            </div>
          </div>

          {/* List Policies */}
          <div className="mt-8">
            <h4 className="text-sm font-medium text-gray-900">{t.examples.listPolicies}</h4>
            <p className="mt-1 text-xs text-gray-500">{t.examples.listPoliciesDesc}</p>
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 uppercase">cURL</span>
                <button
                  onClick={() => copyToClipboard(`curl -X GET https://aster-lang.cloud/api/v1/policies \\
  -H "Authorization: Bearer YOUR_API_KEY"`)}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  {t.copy}
                </button>
              </div>
              <pre className="mt-1 bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto text-xs">
{`curl -X GET https://aster-lang.cloud/api/v1/policies \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
              </pre>
            </div>
          </div>

          {/* Response Example */}
          <div className="mt-8">
            <h4 className="text-sm font-medium text-gray-900">{t.examples.responseExample}</h4>
            <p className="mt-1 text-xs text-gray-500">{t.examples.responseExampleDesc}</p>
            <pre className="mt-3 bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto text-xs">
{`{
  "executionId": "exec_abc123",
  "success": true,
  "output": {
    "allowed": true,
    "matchedRules": ["credit_score_check", "income_verification"],
    "actions": ["approve_loan", "set_interest_rate"]
  },
  "durationMs": 12
}`}
            </pre>
          </div>

          {/* Error Handling */}
          <div className="mt-8">
            <h4 className="text-sm font-medium text-gray-900">{t.examples.errorHandling}</h4>
            <p className="mt-1 text-xs text-gray-500">{t.examples.errorHandlingDesc}</p>
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-md p-3">
              <div className="text-xs text-amber-800 space-y-1">
                <p><code className="bg-amber-100 px-1 rounded">401</code> - {t.examples.error401}</p>
                <p><code className="bg-amber-100 px-1 rounded">403</code> - {t.examples.error403}</p>
                <p><code className="bg-amber-100 px-1 rounded">404</code> - {t.examples.error404}</p>
                <p><code className="bg-amber-100 px-1 rounded">429</code> - {t.examples.error429}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

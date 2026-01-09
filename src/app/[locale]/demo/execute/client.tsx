'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useDemoSession } from '@/components/demo';

interface DemoPolicy {
  id: string;
  name: string;
}

interface ExecutionResult {
  id: string;
  success: boolean;
  output: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
}

interface DemoExecuteClientProps {
  translations: {
    title: string;
    subtitle: string;
    selectPolicy: string;
    noPolicies: string;
    createFirst: string;
    input: string;
    inputPlaceholder: string;
    execute: string;
    executing: string;
    result: string;
    status: string;
    success: string;
    failed: string;
    duration: string;
    decision: string;
    matchedRules: string;
    actions: string;
    error: string;
    invalidJson: string;
    examples: {
      loan: string;
      user: string;
    };
  };
}

const EXAMPLE_INPUTS = {
  loan: {
    credit_score: 720,
    income: 75000,
    loan_amount: 25000,
    employment_status: 'employed',
  },
  user: {
    name: 'John Doe',
    email: 'john@example.com',
    age: 30,
    country: 'US',
  },
};

export function DemoExecuteClient({ translations: t }: DemoExecuteClientProps) {
  const searchParams = useSearchParams();
  const { session } = useDemoSession();

  const [policies, setPolicies] = useState<DemoPolicy[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>('');
  const [input, setInput] = useState<string>(
    JSON.stringify(EXAMPLE_INPUTS.loan, null, 2)
  );
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 加载策略列表
  useEffect(() => {
    async function fetchPolicies() {
      try {
        const response = await fetch('/api/demo/policies');
        if (response.ok) {
          const data = await response.json();
          setPolicies(data.policies);

          // 如果 URL 中指定了策略 ID，则选中它
          const policyId = searchParams.get('policy');
          if (policyId && data.policies.some((p: DemoPolicy) => p.id === policyId)) {
            setSelectedPolicyId(policyId);
          } else if (data.policies.length > 0) {
            setSelectedPolicyId(data.policies[0].id);
          }
        }
      } catch (err) {
        console.error('Error fetching policies:', err);
      } finally {
        setLoading(false);
      }
    }

    if (session) {
      fetchPolicies();
    }
  }, [session, searchParams]);

  const handleExecute = async () => {
    if (!selectedPolicyId) return;

    // 验证 JSON
    let parsedInput;
    try {
      parsedInput = JSON.parse(input);
    } catch {
      setError(t.invalidJson);
      return;
    }

    setExecuting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(
        `/api/demo/policies/${selectedPolicyId}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: parsedInput }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Execution failed');
      }

      setResult(data.execution);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setExecuting(false);
    }
  };

  const loadExampleInput = (type: 'loan' | 'user') => {
    setInput(JSON.stringify(EXAMPLE_INPUTS[type], null, 2));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
        <div className="h-64 bg-gray-200 animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        <p className="text-gray-600 mt-1">{t.subtitle}</p>
      </div>

      {policies.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500 mb-4">{t.noPolicies}</p>
          <Link
            href="/demo/policies/new"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            {t.createFirst}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            {/* Policy Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.selectPolicy}
              </label>
              <select
                value={selectedPolicyId}
                onChange={(e) => setSelectedPolicyId(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                {policies.map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Input */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  {t.input}
                </label>
                <div className="flex space-x-2">
                  <button
                    onClick={() => loadExampleInput('loan')}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    {t.examples.loan}
                  </button>
                  <button
                    onClick={() => loadExampleInput('user')}
                    className="text-xs text-indigo-600 hover:text-indigo-800"
                  >
                    {t.examples.user}
                  </button>
                </div>
              </div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t.inputPlaceholder}
                rows={12}
                className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
              />
            </div>

            {/* Execute Button */}
            <button
              onClick={handleExecute}
              disabled={executing || !selectedPolicyId}
              className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {executing ? t.executing : t.execute}
            </button>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Result Panel */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              {t.result}
            </h2>

            {result ? (
              <div className="space-y-4">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{t.status}</span>
                  <span
                    className={`px-2 py-1 rounded text-sm font-medium ${
                      result.success
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {result.success ? t.success : t.failed}
                  </span>
                </div>

                {/* Duration */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{t.duration}</span>
                  <span className="text-sm text-gray-900">
                    {result.durationMs}ms
                  </span>
                </div>

                {/* Output Details */}
                {result.output && (
                  <>
                    {/* Decision */}
                    {result.output.decision && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">
                          {t.decision}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-sm font-medium ${
                            result.output.decision === 'APPROVED'
                              ? 'bg-green-100 text-green-800'
                              : result.output.decision === 'REJECTED'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {String(result.output.decision)}
                        </span>
                      </div>
                    )}

                    {/* Matched Rules */}
                    {Array.isArray(result.output.matchedRules) &&
                      result.output.matchedRules.length > 0 && (
                        <div>
                          <span className="text-sm text-gray-600 block mb-2">
                            {t.matchedRules}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {result.output.matchedRules.map(
                              (rule: string, i: number) => (
                                <span
                                  key={i}
                                  className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs"
                                >
                                  {rule}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      )}

                    {/* Actions */}
                    {Array.isArray(result.output.actions) &&
                      result.output.actions.length > 0 && (
                        <div>
                          <span className="text-sm text-gray-600 block mb-2">
                            {t.actions}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {result.output.actions.map(
                              (action: string, i: number) => (
                                <span
                                  key={i}
                                  className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs"
                                >
                                  {action}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      )}

                    {/* Raw Output */}
                    <div>
                      <details className="mt-4">
                        <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                          View raw output
                        </summary>
                        <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-64">
                          {JSON.stringify(result.output, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </>
                )}

                {/* Error */}
                {result.error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <span className="text-sm text-red-700">{result.error}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <p>Select a policy and click Execute to see results</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

interface ExecutionResult {
  executionId: string;
  success: boolean;
  output?: {
    matchedRules: string[];
    actions: string[];
    approved: boolean;
  };
  error?: string;
  durationMs: number;
}

/**
 * CNL 策略测试数据
 *
 * 重要说明：Aster CNL 运行时期望 context 为参数值数组，按函数参数顺序传入。
 * 不需要用参数名包装数据，直接传入字段值即可。
 *
 * 例如，对于函数声明：
 *   评估贷款 入参 申请人：申请人，产出 结果：
 *
 * context 应为：
 *   [{ 编号: "A001", 信用评分: 720, ... }]
 *
 * 而不是：
 *   [{ 申请人: { 编号: "A001", ... } }]
 */

// 英文策略测试数据
const EXAMPLE_INPUTS_EN = {
  loanApplication: {
    id: 'A001',
    creditScore: 720,
    income: 85000,
    debtToIncomeRatio: 0.35,
    loanAmount: 50000,
  },
  userVerification: {
    email: 'user@example.com',
    phoneVerified: true,
    documentsSubmitted: true,
  },
};

// 中文策略测试数据（字段名与中文 CNL 类型定义匹配）
const EXAMPLE_INPUTS_ZH = {
  loanApplication: {
    编号: 'A001',
    信用评分: 720,
    收入: 85000,
    申请金额: 50000,
  },
  userVerification: {
    邮箱: 'user@example.com',
    手机已验证: true,
    资料已提交: true,
  },
};

// 德语策略测试数据（字段名与德语 CNL 类型定义匹配）
const EXAMPLE_INPUTS_DE = {
  loanApplication: {
    kennung: 'A001',
    bonitaet: 720,
    einkommen: 85000,
    kreditbetrag: 50000,
  },
  userVerification: {
    email: 'user@example.com',
    telefonVerifiziert: true,
    dokumenteEingereicht: true,
  },
};

// 检测策略语言类型
type PolicyLocale = 'zh' | 'de' | 'en';

function detectPolicyLocale(content: string): PolicyLocale {
  const chinesePatterns = [/【模块】/, /【定义】/, /入参.*产出/, /模块\s+\S+。/, /定义\s+\S+\s+包含/];
  if (chinesePatterns.some((p) => p.test(content))) {
    return 'zh';
  }
  const germanPatterns = [/Dieses Modul ist/i, /Definiere\s+\w+\s+mit/i, /Falls\s+/i, /Gib zurück/i];
  if (germanPatterns.some((p) => p.test(content))) {
    return 'de';
  }
  return 'en';
}

interface ExecutePolicyContentProps {
  policyId: string;
  locale: string;
}

// 根据策略语言类型获取对应的测试数据
function getExampleInputs(policyLocale: PolicyLocale) {
  switch (policyLocale) {
    case 'zh':
      return EXAMPLE_INPUTS_ZH;
    case 'de':
      return EXAMPLE_INPUTS_DE;
    default:
      return EXAMPLE_INPUTS_EN;
  }
}

export function ExecutePolicyContent({ policyId, locale }: ExecutePolicyContentProps) {
  const t = useTranslations('policies.execute');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [policyName, setPolicyName] = useState('');
  const [policyLocale, setPolicyLocale] = useState<PolicyLocale>('en');

  useEffect(() => {
    // Fetch policy details including content
    fetch(`/api/policies/${policyId}`)
      .then((res) => res.json())
      .then((data) => {
        setPolicyName(data.name);
        // 检测策略语言并设置对应的默认测试数据
        const detectedLocale = detectPolicyLocale(data.content || '');
        setPolicyLocale(detectedLocale);
        const examples = getExampleInputs(detectedLocale);
        setInput(JSON.stringify(examples.loanApplication, null, 2));
      })
      .catch(() => {
        // 默认使用英文测试数据
        setInput(JSON.stringify(EXAMPLE_INPUTS_EN.loanApplication, null, 2));
      });
  }, [policyId]);

  const handleExecute = async () => {
    setIsLoading(true);
    setError('');
    setResult(null);

    try {
      const parsedInput = JSON.parse(input);

      const res = await fetch(`/api/policies/${policyId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: parsedInput }),
      });

      const data = await res.json();

      if (!res.ok) {
        // 优先显示详细消息，支持冻结和配额超限场景
        const errorMessage = data.message || data.error || t('executionFailed');
        setError(errorMessage);
        // 保存是否需要升级的标志
        if (data.upgrade || data.frozen) {
          setError(`${errorMessage}|UPGRADE`);
        }
        return;
      }

      setResult(data);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError(t('invalidJson'));
      } else {
        setError(err instanceof Error ? err.message : t('executionFailed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const loadExample = (type: 'loanApplication' | 'userVerification') => {
    const examples = getExampleInputs(policyLocale);
    setInput(JSON.stringify(examples[type], null, 2));
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center">
          <Link href={`/${locale}/policies/${policyId}`} className="text-gray-400 hover:text-gray-600 mr-2">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('title', { name: policyName || 'Policy' })}
          </h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {t('subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="bg-white shadow-lg sm:rounded-xl border border-gray-200">
          <div className="px-6 py-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{t('input')}</h3>
              <div className="flex space-x-3">
                <button
                  onClick={() => loadExample('loanApplication')}
                  className="text-xs text-indigo-600 hover:text-indigo-500 font-medium"
                >
                  {t('loanExample')}
                </button>
                <button
                  onClick={() => loadExample('userVerification')}
                  className="text-xs text-indigo-600 hover:text-indigo-500 font-medium"
                >
                  {t('userExample')}
                </button>
              </div>
            </div>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={12}
              className="block w-full rounded-lg border border-gray-300 bg-gray-900 px-4 py-3 text-gray-100 placeholder-gray-500 shadow-sm font-mono text-sm leading-relaxed transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
              placeholder={t('inputPlaceholder')}
            />

            <button
              onClick={handleExecute}
              disabled={isLoading}
              className="mt-4 w-full inline-flex justify-center items-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('executing')}
                </>
              ) : (
                t('executeButton')
              )}
            </button>
          </div>
        </div>

        {/* Result Panel */}
        <div className="bg-white shadow-lg sm:rounded-xl border border-gray-200">
          <div className="px-6 py-6 sm:p-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('result')}</h3>

            {error && (() => {
              const needsUpgrade = error.includes('|UPGRADE');
              const displayError = error.replace('|UPGRADE', '');
              return (
                <div className="rounded-lg bg-red-50 p-4">
                  <div className="flex">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                    </svg>
                    <div className="ml-3">
                      <p className="text-sm text-red-700">{displayError}</p>
                      {needsUpgrade && (
                        <Link href={`/${locale}/billing`} className="mt-1 block text-sm font-medium text-red-700 underline">
                          {t('upgradePlan')}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {result && (
              <div className="space-y-4">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">{t('status')}</span>
                  {result.success ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">
                      {t('success')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-medium text-red-800">
                      {t('failed')}
                    </span>
                  )}
                </div>

                {/* Duration */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">{t('duration')}</span>
                  <span className="text-sm font-medium text-gray-900">{result.durationMs}ms</span>
                </div>

                {/* Decision */}
                {result.output && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">{t('decision')}</span>
                    {result.output.approved ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">
                        {t('approved')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-medium text-red-800">
                        {t('rejected')}
                      </span>
                    )}
                  </div>
                )}

                {/* Matched Rules */}
                {result.output?.matchedRules && result.output.matchedRules.length > 0 && (
                  <div>
                    <span className="text-sm font-medium text-gray-700">{t('matchedRules')}</span>
                    <ul className="mt-2 space-y-1">
                      {result.output.matchedRules.map((rule, i) => (
                        <li key={i} className="text-sm text-gray-600 flex items-center">
                          <svg className="h-4 w-4 text-green-500 mr-2" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                          </svg>
                          {rule}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                {result.output?.actions && result.output.actions.length > 0 && (
                  <div>
                    <span className="text-sm font-medium text-gray-700">{t('actions')}</span>
                    <ul className="mt-2 space-y-1">
                      {result.output.actions.map((action, i) => (
                        <li key={i} className="text-sm text-gray-600 bg-gray-50 px-2 py-1 rounded">
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Error */}
                {result.error && (
                  <div className="rounded-lg bg-red-50 p-4">
                    <p className="text-sm text-red-700">{result.error}</p>
                  </div>
                )}

                {/* Raw Output */}
                <details className="mt-4">
                  <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
                    {t('viewRawOutput')}
                  </summary>
                  <pre className="mt-2 bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </details>
              </div>
            )}

            {!result && !error && (
              <div className="text-center py-12 text-gray-500">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="mt-2">{t('emptyState')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ParameterInfo, TypeKind } from '@/services/policy/policy-api';
import {
  POLICY_EXAMPLES,
  type PolicyExample,
  getExampleName,
  getExampleDescription,
  getCategoryLabel,
} from '@/data/policy-examples';

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

interface PolicySchema {
  success: boolean;
  moduleName?: string;
  functionName?: string;
  parameters?: ParameterInfo[];
  error?: string;
}

type InputMode = 'form' | 'json';

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

// 默认值工厂：根据类型生成初始值
function getDefaultValue(typeKind: TypeKind, typeName: string): unknown {
  switch (typeKind) {
    case 'primitive':
      if (['int', 'integer', 'long', '整数', '长整数', 'ganzzahl', 'langzahl'].some(t => typeName.toLowerCase().includes(t))) {
        return 0;
      }
      if (['double', 'float', 'decimal', '小数', '浮点数', 'dezimal'].some(t => typeName.toLowerCase().includes(t))) {
        return 0.0;
      }
      if (['bool', 'boolean', '布尔', 'wahrheitswert'].some(t => typeName.toLowerCase().includes(t))) {
        return false;
      }
      return '';
    case 'struct':
      return {};
    case 'list':
      return [];
    case 'option':
      return null;
    default:
      return '';
  }
}

// 从表单值构建命名上下文
function buildNamedContext(
  formValues: Record<string, Record<string, unknown>>,
  parameters: ParameterInfo[]
): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  for (const param of parameters) {
    const value = formValues[param.name];
    if (value !== undefined) {
      context[param.name] = value;
    }
  }
  return context;
}

// 初始化表单值
function initFormValues(parameters: ParameterInfo[]): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {};
  for (const param of parameters) {
    if (param.typeKind === 'struct' && param.fields) {
      const structValue: Record<string, unknown> = {};
      for (const field of param.fields) {
        structValue[field.name] = getDefaultValue(field.typeKind, field.type);
      }
      values[param.name] = structValue;
    } else {
      values[param.name] = getDefaultValue(param.typeKind, param.type) as Record<string, unknown>;
    }
  }
  return values;
}

export function ExecutePolicyContent({ policyId, locale }: ExecutePolicyContentProps) {
  const t = useTranslations('policies.execute');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [policyName, setPolicyName] = useState('');
  const [policyLocale, setPolicyLocale] = useState<PolicyLocale>('en');

  // 新增状态：动态表单
  const [inputMode, setInputMode] = useState<InputMode>('json');
  const [schema, setSchema] = useState<PolicySchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, Record<string, unknown>>>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [policyContent, setPolicyContent] = useState('');

  // 策略示例选择
  const [selectedExample, setSelectedExample] = useState<PolicyExample | null>(null);
  const [showExampleSelector, setShowExampleSelector] = useState(false);
  const [showSourceCode, setShowSourceCode] = useState(false);

  // 保存策略状态
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 获取策略参数模式
  const fetchSchema = useCallback(async (content: string, detectedLocale: PolicyLocale) => {
    if (!content) return;

    setSchemaLoading(true);
    try {
      const localeMap: Record<PolicyLocale, string> = {
        zh: 'zh-CN',
        de: 'de-DE',
        en: 'en-US',
      };

      const res = await fetch('/api/policies/schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: content,
          locale: localeMap[detectedLocale],
        }),
      });

      const data: PolicySchema = await res.json();
      if (data.success && data.parameters && data.parameters.length > 0) {
        setSchema(data);
        // 初始化表单值
        setFormValues(initFormValues(data.parameters));
      }
    } catch (err) {
      console.error('Failed to fetch schema:', err);
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch policy details including content
    fetch(`/api/policies/${policyId}`)
      .then((res) => res.json())
      .then((data) => {
        setPolicyName(data.name);
        setPolicyContent(data.content || '');
        // 检测策略语言并设置对应的默认测试数据
        const detectedLocale = detectPolicyLocale(data.content || '');
        setPolicyLocale(detectedLocale);
        const examples = getExampleInputs(detectedLocale);
        setInput(JSON.stringify(examples.loanApplication, null, 2));
        // 获取策略参数模式
        if (data.content) {
          fetchSchema(data.content, detectedLocale);
        }
      })
      .catch(() => {
        // 默认使用英文测试数据
        setInput(JSON.stringify(EXAMPLE_INPUTS_EN.loanApplication, null, 2));
      });
  }, [policyId, fetchSchema]);

  // 更新表单字段值
  const updateFormField = (paramName: string, fieldName: string | null, value: unknown) => {
    setFormValues(prev => {
      const newValues = { ...prev };
      if (fieldName === null) {
        // 直接更新参数值（非结构体类型）
        newValues[paramName] = value as Record<string, unknown>;
      } else {
        // 更新结构体字段
        newValues[paramName] = {
          ...prev[paramName],
          [fieldName]: value,
        };
      }
      return newValues;
    });
  };

  const handleExecute = async () => {
    setIsLoading(true);
    setError('');
    setResult(null);

    try {
      let parsedInput: unknown;

      if (inputMode === 'form' && schema?.parameters) {
        // 从表单构建命名上下文
        parsedInput = buildNamedContext(formValues, schema.parameters);
      } else {
        // JSON 模式：解析输入
        parsedInput = JSON.parse(input);
      }

      let res: Response;

      if (selectedExample) {
        // 使用示例策略：通过 evaluate-source API 直接执行源代码
        res = await fetch('/api/policies/evaluate-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: selectedExample.source,
            context: parsedInput,
            locale: selectedExample.locale,
          }),
        });
      } else {
        // 使用已保存的策略：通过 policyId 执行
        res = await fetch(`/api/policies/${policyId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: parsedInput }),
        });
      }

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

  // 选择策略示例
  const handleSelectExample = useCallback(
    (example: PolicyExample) => {
      setSelectedExample(example);
      setShowExampleSelector(false);
      setPolicyContent(example.source);
      setPolicyName(getExampleName(example, locale));

      // 设置语言
      const localeMap: Record<string, PolicyLocale> = {
        'zh-CN': 'zh',
        'en-US': 'en',
        'de-DE': 'de',
      };
      const detectedLocale = localeMap[example.locale] || 'en';
      setPolicyLocale(detectedLocale);

      // 设置默认输入
      setInput(JSON.stringify(example.defaultInput, null, 2));

      // 获取 schema 并初始化表单
      fetchSchema(example.source, detectedLocale);

      // 重置结果
      setResult(null);
      setError('');
    },
    [locale, fetchSchema]
  );

  // 保存示例策略到我的策略
  const handleSavePolicy = useCallback(async () => {
    if (!selectedExample) return;

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: getExampleName(selectedExample, locale),
          content: selectedExample.source,
          description: getExampleDescription(selectedExample, locale),
          isPublic: false,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.upgrade) {
          setSaveMessage({ type: 'error', text: t('policyLimitReached') });
        } else {
          setSaveMessage({ type: 'error', text: data.error || t('saveError') });
        }
        return;
      }

      setSaveMessage({ type: 'success', text: t('savedSuccessfully') });
      // 3秒后清除成功消息
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({
        type: 'error',
        text: err instanceof Error ? err.message : t('saveError'),
      });
    } finally {
      setIsSaving(false);
    }
  }, [selectedExample, locale, t]);

  // 渲染单个表单字段
  const renderField = (
    paramName: string,
    fieldName: string | null,
    typeName: string,
    typeKind: TypeKind,
    value: unknown
  ) => {
    const id = fieldName ? `${paramName}-${fieldName}` : paramName;
    const label = fieldName || paramName;

    // 根据类型渲染不同的输入控件
    if (['bool', 'boolean', '布尔', 'wahrheitswert'].some(t => typeName.toLowerCase().includes(t))) {
      return (
        <div key={id} className="flex items-center gap-2">
          <input
            type="checkbox"
            id={id}
            checked={Boolean(value)}
            onChange={(e) => updateFormField(paramName, fieldName, e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <label htmlFor={id} className="text-sm font-medium text-gray-700">
            {label}
          </label>
          <span className="text-xs text-gray-400">({typeName})</span>
        </div>
      );
    }

    if (['int', 'integer', 'long', '整数', '长整数', 'ganzzahl', 'langzahl'].some(t => typeName.toLowerCase().includes(t))) {
      return (
        <div key={id}>
          <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
            {label} <span className="text-xs text-gray-400">({typeName})</span>
          </label>
          <input
            type="number"
            id={id}
            value={value as number ?? 0}
            onChange={(e) => updateFormField(paramName, fieldName, parseInt(e.target.value, 10) || 0)}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
        </div>
      );
    }

    if (['double', 'float', 'decimal', '小数', '浮点数', 'dezimal'].some(t => typeName.toLowerCase().includes(t))) {
      return (
        <div key={id}>
          <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
            {label} <span className="text-xs text-gray-400">({typeName})</span>
          </label>
          <input
            type="number"
            step="0.01"
            id={id}
            value={value as number ?? 0}
            onChange={(e) => updateFormField(paramName, fieldName, parseFloat(e.target.value) || 0)}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
        </div>
      );
    }

    // 默认：文本输入
    return (
      <div key={id}>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
          {label} <span className="text-xs text-gray-400">({typeName})</span>
        </label>
        <input
          type="text"
          id={id}
          value={String(value ?? '')}
          onChange={(e) => updateFormField(paramName, fieldName, e.target.value)}
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
      </div>
    );
  };

  // 渲染参数表单
  const renderParameterForm = (param: ParameterInfo) => {
    const paramValue = formValues[param.name];

    if (param.typeKind === 'struct' && param.fields && param.fields.length > 0) {
      // 结构体类型：渲染字段组
      return (
        <div key={param.name} className="border border-gray-200 rounded-lg p-4 mb-4">
          <h4 className="text-sm font-semibold text-gray-800 mb-3">
            {param.name} <span className="text-xs font-normal text-gray-400">({param.type})</span>
          </h4>
          <div className="space-y-3">
            {param.fields.map((field) =>
              renderField(
                param.name,
                field.name,
                field.type,
                field.typeKind,
                (paramValue as Record<string, unknown>)?.[field.name]
              )
            )}
          </div>
        </div>
      );
    }

    // 基本类型：直接渲染
    return (
      <div key={param.name} className="mb-4">
        {renderField(param.name, null, param.type, param.typeKind, paramValue)}
      </div>
    );
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

      {/* 策略示例选择器 */}
      <div className="mb-6 bg-white shadow-sm sm:rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">
              {locale.startsWith('zh') ? '选择示例策略：' : 'Select Example Policy:'}
            </span>
            <div className="relative">
              <button
                onClick={() => setShowExampleSelector(!showExampleSelector)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {selectedExample
                  ? getExampleName(selectedExample, locale)
                  : locale.startsWith('zh')
                    ? '选择策略...'
                    : 'Choose a policy...'}
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
                    {(['loan', 'insurance', 'healthcare', 'verification'] as const).map((category) => {
                      const categoryExamples = POLICY_EXAMPLES.filter((e) => e.category === category);
                      if (categoryExamples.length === 0) return null;
                      return (
                        <div key={category}>
                          <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                            {getCategoryLabel(category, locale)}
                          </div>
                          {categoryExamples.map((example) => (
                            <button
                              key={example.id}
                              onClick={() => handleSelectExample(example)}
                              className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 ${
                                selectedExample?.id === example.id ? 'bg-indigo-100 text-indigo-900' : 'text-gray-700'
                              }`}
                            >
                              <div className="font-medium">{getExampleName(example, locale)}</div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {getExampleDescription(example, locale)}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                {example.locale === 'zh-CN' ? '🇨🇳 中文' : example.locale === 'de-DE' ? '🇩🇪 Deutsch' : '🇺🇸 English'}
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

          {/* 查看源代码和保存按钮 */}
          {selectedExample && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSourceCode(!showSourceCode)}
                className="text-sm text-indigo-600 hover:text-indigo-500 font-medium flex items-center gap-1"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                {showSourceCode
                  ? locale.startsWith('zh')
                    ? '隐藏源代码'
                    : 'Hide Source'
                  : locale.startsWith('zh')
                    ? '查看源代码'
                    : 'View Source'}
              </button>
              <button
                onClick={handleSavePolicy}
                disabled={isSaving}
                className="text-sm bg-green-600 hover:bg-green-700 text-white font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {t('saving')}
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    {t('saveToMyPolicies')}
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* 保存消息提示 */}
        {saveMessage && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${
            saveMessage.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            <div className="flex items-center gap-2">
              {saveMessage.type === 'success' ? (
                <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {saveMessage.text}
            </div>
          </div>
        )}

        {/* 源代码显示 */}
        {showSourceCode && selectedExample && (
          <div className="mt-4 rounded-lg bg-gray-900 p-4 overflow-x-auto">
            <pre className="text-sm text-gray-100 whitespace-pre-wrap font-mono">{selectedExample.source}</pre>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="bg-white shadow-lg sm:rounded-xl border border-gray-200">
          <div className="px-6 py-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">{t('input')}</h3>
              <div className="flex items-center space-x-3">
                {/* Mode Toggle */}
                {schema?.parameters && schema.parameters.length > 0 && (
                  <div className="flex rounded-lg bg-gray-100 p-1">
                    <button
                      onClick={() => setInputMode('form')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        inputMode === 'form'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Form
                    </button>
                    <button
                      onClick={() => setInputMode('json')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        inputMode === 'json'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      JSON
                    </button>
                  </div>
                )}
                {inputMode === 'json' && (
                  <>
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
                  </>
                )}
              </div>
            </div>

            {/* Schema Loading Indicator */}
            {schemaLoading && (
              <div className="flex items-center justify-center py-4 text-sm text-gray-500">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading schema...
              </div>
            )}

            {/* Form Mode */}
            {inputMode === 'form' && schema?.parameters && schema.parameters.length > 0 && !schemaLoading && (
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {schema.functionName && (
                  <div className="text-sm text-gray-500 mb-2">
                    Function: <span className="font-mono text-gray-700">{schema.functionName}</span>
                  </div>
                )}
                {schema.parameters.map((param) => renderParameterForm(param))}
              </div>
            )}

            {/* JSON Mode */}
            {inputMode === 'json' && (
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={12}
                className="block w-full rounded-lg border border-gray-300 bg-gray-900 px-4 py-3 text-gray-100 placeholder-gray-500 shadow-sm font-mono text-sm leading-relaxed transition-all duration-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                placeholder={t('inputPlaceholder')}
              />
            )}

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

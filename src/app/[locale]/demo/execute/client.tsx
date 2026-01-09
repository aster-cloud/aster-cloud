'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useDemoSession } from '@/components/demo';

interface DemoPolicy {
  id: string;
  name: string;
  content?: string;
  defaultInput?: Record<string, unknown>;
}

interface ExecutionResult {
  id: string;
  success: boolean;
  output: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
}

// 策略语言类型
type PolicyLocale = 'zh' | 'de' | 'en';

// 类型定义（与 Production 版本一致）
type TypeKind = 'primitive' | 'struct' | 'list' | 'option' | 'unknown';

interface FieldInfo {
  name: string;
  type: string;
  typeKind: TypeKind;
}

interface ParameterInfo {
  name: string;
  type: string;
  typeKind: TypeKind;
  fields?: FieldInfo[];
}

interface PolicySchema {
  success: boolean;
  moduleName?: string;
  functionName?: string;
  parameters?: ParameterInfo[];
  error?: string;
}

// 检测策略语言类型（从策略内容自动检测）
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
    policyPreview: string;
    showJsonEditor: string;
    showForm: string;
    viewRawOutput?: string;
    selectAndExecute?: string;
    noFormFields?: string;
    loadingSchema?: string;
    decisions?: {
      approved: string;
      rejected: string;
      review: string;
      pending: string;
    };
    examples: {
      loan: string;
      user: string;
    };
  };
  locale?: string;
}

// 渲染单个表单字段（支持类型感知）
function renderFormField(
  id: string,
  label: string,
  typeName: string,
  value: unknown,
  onChange: (value: unknown) => void
) {
  // 布尔类型
  if (['bool', 'boolean', '布尔', 'wahrheitswert'].some(t => typeName.toLowerCase().includes(t))) {
    return (
      <div key={id} className="flex items-center gap-2">
        <input
          type="checkbox"
          id={id}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </label>
        <span className="text-xs text-gray-400">({typeName})</span>
      </div>
    );
  }

  // 整数类型
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
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
        />
      </div>
    );
  }

  // 浮点数类型
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
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
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
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
      />
    </div>
  );
}

// Schema 驱动的参数表单渲染
function SchemaFormField({
  param,
  value,
  onChange,
}: {
  param: ParameterInfo;
  value: Record<string, unknown>;
  onChange: (paramName: string, fieldName: string | null, newValue: unknown) => void;
}) {
  if (param.typeKind === 'struct' && param.fields && param.fields.length > 0) {
    // 结构体类型：渲染字段组
    return (
      <div className="border border-gray-200 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-semibold text-gray-800 mb-3">
          {param.name} <span className="text-xs font-normal text-gray-400">({param.type})</span>
        </h4>
        <div className="space-y-3">
          {param.fields.map((field) =>
            renderFormField(
              `${param.name}-${field.name}`,
              field.name,
              field.type,
              (value as Record<string, unknown>)?.[field.name],
              (newValue) => onChange(param.name, field.name, newValue)
            )
          )}
        </div>
      </div>
    );
  }

  // 基本类型：直接渲染
  return (
    <div className="mb-4">
      {renderFormField(
        param.name,
        param.name,
        param.type,
        value,
        (newValue) => onChange(param.name, null, newValue)
      )}
    </div>
  );
}

// 简单动态表单字段渲染（基于值类型推断，用于无 schema 时的回退）
function DynamicFormField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}) {
  const fieldType = typeof value;

  // 处理嵌套对象（递归渲染）
  if (fieldType === 'object' && value !== null && !Array.isArray(value)) {
    return (
      <div className="border border-gray-200 rounded-lg p-3 mb-2">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          {name}
        </label>
        <div className="space-y-2 pl-2">
          {Object.entries(value as Record<string, unknown>).map(([subKey, subValue]) => (
            <DynamicFormField
              key={subKey}
              name={subKey}
              value={subValue}
              onChange={(fieldName, newValue) => {
                onChange(name, { ...(value as Record<string, unknown>), [fieldName]: newValue });
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // 处理数组（显示为 JSON）
  if (Array.isArray(value)) {
    return (
      <div>
        <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
          {name} <span className="text-xs text-gray-400">(array)</span>
        </label>
        <textarea
          id={name}
          value={JSON.stringify(value, null, 2)}
          onChange={(e) => {
            try {
              onChange(name, JSON.parse(e.target.value));
            } catch {
              // 保持原值如果 JSON 解析失败
            }
          }}
          rows={3}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
        />
      </div>
    );
  }

  if (fieldType === 'boolean') {
    return (
      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          id={name}
          checked={value as boolean}
          onChange={(e) => onChange(name, e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor={name} className="text-sm text-gray-700">
          {name}
        </label>
      </div>
    );
  }

  if (fieldType === 'number') {
    return (
      <div>
        <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
          {name}
        </label>
        <input
          type="number"
          id={name}
          value={value as number}
          onChange={(e) => onChange(name, parseFloat(e.target.value) || 0)}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
        />
      </div>
    );
  }

  // 字符串或其他类型
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
        {name}
      </label>
      <input
        type="text"
        id={name}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(name, e.target.value)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
      />
    </div>
  );
}

export function DemoExecuteClient({ translations: t, locale = 'en' }: DemoExecuteClientProps) {
  const searchParams = useSearchParams();
  const { session } = useDemoSession();

  const [policies, setPolicies] = useState<DemoPolicy[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>('');
  const [inputMode, setInputMode] = useState<'form' | 'json'>('form');
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [jsonInput, setJsonInput] = useState<string>('{}');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);

  // Schema 相关状态
  const [schema, setSchema] = useState<PolicySchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaFormValues, setSchemaFormValues] = useState<Record<string, Record<string, unknown>>>({});
  const [policyLocale, setPolicyLocale] = useState<PolicyLocale>('en');

  // 当前选中的策略
  const selectedPolicy = useMemo(
    () => policies.find((p) => p.id === selectedPolicyId),
    [policies, selectedPolicyId]
  );

  // 获取策略参数模式
  const fetchSchema = useCallback(async (content: string) => {
    if (!content) return;

    setSchemaLoading(true);
    try {
      const detectedLocale = detectPolicyLocale(content);
      setPolicyLocale(detectedLocale);

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
        setSchemaFormValues(initFormValues(data.parameters));
      } else {
        setSchema(null);
      }
    } catch (err) {
      console.error('Failed to fetch schema:', err);
      setSchema(null);
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  // 更新 schema 表单字段
  const handleSchemaFormChange = useCallback((paramName: string, fieldName: string | null, newValue: unknown) => {
    setSchemaFormValues(prev => {
      const updated = { ...prev };
      if (fieldName) {
        // 更新嵌套字段
        updated[paramName] = {
          ...(updated[paramName] as Record<string, unknown> || {}),
          [fieldName]: newValue,
        };
      } else {
        // 更新顶级字段
        updated[paramName] = newValue as Record<string, unknown>;
      }
      // 同步到 JSON
      setJsonInput(JSON.stringify(updated, null, 2));
      return updated;
    });
  }, []);

  // 加载策略列表（包含 content 和 defaultInput）
  useEffect(() => {
    async function fetchPolicies() {
      try {
        const response = await fetch('/api/demo/policies?include=content,defaultInput');
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

  // 当选中的策略改变时，更新输入数据并获取 schema
  useEffect(() => {
    if (selectedPolicy?.defaultInput) {
      setFormData(selectedPolicy.defaultInput);
      setJsonInput(JSON.stringify(selectedPolicy.defaultInput, null, 2));
    } else {
      setFormData({});
      setJsonInput('{}');
    }
    setResult(null);
    setError(null);

    // 如果有策略内容，获取 schema
    if (selectedPolicy?.content) {
      fetchSchema(selectedPolicy.content);
    } else {
      setSchema(null);
      setPolicyLocale('en');
    }
  }, [selectedPolicy, fetchSchema]);

  // 处理表单字段变化
  const handleFormFieldChange = (name: string, value: unknown) => {
    const newFormData = { ...formData, [name]: value };
    setFormData(newFormData);
    setJsonInput(JSON.stringify(newFormData, null, 2));
  };

  // 处理 JSON 输入变化
  const handleJsonChange = (value: string) => {
    setJsonInput(value);
    try {
      const parsed = JSON.parse(value);
      setFormData(parsed);
      setError(null);
    } catch {
      // JSON 解析错误时保留原始 formData
    }
  };

  const handleExecute = async () => {
    if (!selectedPolicyId) return;

    // 获取输入数据
    let parsedInput: Record<string, unknown>;
    if (inputMode === 'json') {
      try {
        parsedInput = JSON.parse(jsonInput);
      } catch {
        setError(t.invalidJson);
        return;
      }
    } else if (schema?.parameters && schema.parameters.length > 0) {
      // 使用 schema 表单值
      parsedInput = schemaFormValues;
    } else {
      parsedInput = formData;
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

  // 获取决策显示文本（优先使用翻译文件）
  const getDecisionLabel = (decision: string) => {
    // 优先使用翻译文件中的决策标签
    if (t.decisions) {
      const key = decision.toLowerCase() as keyof typeof t.decisions;
      if (t.decisions[key]) {
        return t.decisions[key];
      }
    }
    // 回退到硬编码映射
    const labels: Record<string, Record<string, string>> = {
      'APPROVED': { en: 'Approved', zh: '通过', de: 'Genehmigt' },
      'REJECTED': { en: 'Rejected', zh: '拒绝', de: 'Abgelehnt' },
      'REVIEW': { en: 'Manual Review', zh: '人工审核', de: 'Manuelle Überprüfung' },
      'PENDING': { en: 'Pending', zh: '待处理', de: 'Ausstehend' },
    };
    const lang = locale.startsWith('zh') ? 'zh' : locale.startsWith('de') ? 'de' : 'en';
    return labels[decision]?.[lang] || decision;
  };

  // 获取策略语言标记
  const getPolicyLocaleLabel = () => {
    switch (policyLocale) {
      case 'zh': return '🇨🇳 中文';
      case 'de': return '🇩🇪 Deutsch';
      default: return '🇺🇸 English';
    }
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
          <div className="space-y-4">
            {/* Policy Selector */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
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

            {/* Policy Preview Toggle */}
            {selectedPolicy?.content && (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="flex items-center justify-between w-full text-sm font-medium text-gray-700"
                >
                  <div className="flex items-center gap-2">
                    <span>{t.policyPreview}</span>
                    {/* 策略语言标记 */}
                    <span className="text-xs text-gray-400">{getPolicyLocaleLabel()}</span>
                  </div>
                  <svg
                    className={`w-5 h-5 transition-transform ${showPreview ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPreview && (
                  <div className="mt-3 rounded-lg bg-gray-900 p-4 overflow-x-auto max-h-64">
                    <pre className="text-sm text-gray-100 whitespace-pre-wrap font-mono">
                      {selectedPolicy.content}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Input Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700">
                  {t.input}
                </label>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setInputMode('form')}
                    className={`text-xs px-2 py-1 rounded ${
                      inputMode === 'form'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    {t.showForm}
                  </button>
                  <button
                    onClick={() => setInputMode('json')}
                    className={`text-xs px-2 py-1 rounded ${
                      inputMode === 'json'
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    {t.showJsonEditor}
                  </button>
                </div>
              </div>

              {inputMode === 'form' ? (
                <div className="space-y-3">
                  {/* Schema 加载指示器 */}
                  {schemaLoading && (
                    <div className="flex items-center justify-center py-4 text-sm text-gray-500">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {t.loadingSchema || (locale.startsWith('zh') ? '加载表单...' : locale.startsWith('de') ? 'Lade Formular...' : 'Loading schema...')}
                    </div>
                  )}

                  {/* Schema 驱动的表单 */}
                  {!schemaLoading && schema?.parameters && schema.parameters.length > 0 ? (
                    <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                      {schema.functionName && (
                        <div className="text-sm text-gray-500 mb-2">
                          Function: <span className="font-mono text-gray-700">{schema.functionName}</span>
                        </div>
                      )}
                      {schema.parameters.map((param) => (
                        <SchemaFormField
                          key={param.name}
                          param={param}
                          value={schemaFormValues[param.name] || {}}
                          onChange={handleSchemaFormChange}
                        />
                      ))}
                    </div>
                  ) : !schemaLoading && Object.keys(formData).length > 0 ? (
                    // 回退到简单动态表单
                    Object.entries(formData).map(([key, value]) => (
                      <DynamicFormField
                        key={key}
                        name={key}
                        value={value}
                        onChange={handleFormFieldChange}
                      />
                    ))
                  ) : !schemaLoading ? (
                    <p className="text-sm text-gray-500 italic">
                      {t.noFormFields || (locale.startsWith('zh')
                        ? '请切换到 JSON 编辑器输入数据'
                        : locale.startsWith('de')
                          ? 'Bitte wechseln Sie zum JSON-Editor'
                          : 'Please switch to JSON editor to input data')}
                    </p>
                  ) : null}
                </div>
              ) : (
                <textarea
                  value={jsonInput}
                  onChange={(e) => handleJsonChange(e.target.value)}
                  placeholder={t.inputPlaceholder}
                  rows={10}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                />
              )}

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
                          {getDecisionLabel(String(result.output.decision))}
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
                          {t.viewRawOutput || (locale.startsWith('zh')
                            ? '查看原始输出'
                            : locale.startsWith('de')
                              ? 'Rohausgabe anzeigen'
                              : 'View raw output')}
                        </summary>
                        <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded-lg text-xs overflow-auto max-h-64">
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
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <p className="mt-2">
                  {t.selectAndExecute || (locale.startsWith('zh')
                    ? '选择策略并点击执行查看结果'
                    : locale.startsWith('de')
                      ? 'Wählen Sie eine Richtlinie und klicken Sie auf Ausführen'
                      : 'Select a policy and click Execute to see results')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

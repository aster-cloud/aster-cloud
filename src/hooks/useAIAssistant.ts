'use client';

import { useCallback } from 'react';
import { useSSEStream } from './useSSEStream';
import { API_ENDPOINTS } from '@/config/api-versions';

const getApiBaseUrl = () =>
  process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL || 'https://policy.aster-lang.dev';

export interface GenerateOptions {
  goal: string;
  locale: string;
  existingSource?: string;
  schema?: unknown;
  model?: string;
}

export interface ExplainOptions {
  source: string;
  locale: string;
  traceData?: unknown;
}

export interface SuggestOptions {
  source: string;
  locale: string;
  focus?: string;
  model?: string;
}

export interface UseAIAssistantResult {
  streaming: boolean;
  content: string;
  error: string | null;
  validationError: string | null;
  completed: boolean;
  /** 编译是否通过（final 事件携带） */
  validated: boolean;
  /** 修复进度（如 "2/5"） */
  repairProgress: string | null;
  generate: (options: GenerateOptions, tenantId?: string) => Promise<void>;
  explain: (options: ExplainOptions, tenantId?: string) => Promise<void>;
  suggest: (options: SuggestOptions, tenantId?: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useAIAssistant(): UseAIAssistantResult {
  const sse = useSSEStream();

  const generate = useCallback(async (options: GenerateOptions, tenantId?: string) => {
    const baseUrl = getApiBaseUrl();
    const headers: Record<string, string> = {};
    if (tenantId) headers['X-Tenant-Id'] = tenantId;

    await sse.startStream(
      `${baseUrl}${API_ENDPOINTS.aiGenerate}`,
      {
        goal: options.goal,
        locale: options.locale,
        existingSource: options.existingSource,
        schema: options.schema,
        model: options.model,
      },
      headers,
    );
  }, [sse]);

  const explain = useCallback(async (options: ExplainOptions, tenantId?: string) => {
    const baseUrl = getApiBaseUrl();
    const headers: Record<string, string> = {};
    if (tenantId) headers['X-Tenant-Id'] = tenantId;

    await sse.startStream(
      `${baseUrl}${API_ENDPOINTS.aiExplain}`,
      {
        source: options.source,
        locale: options.locale,
        traceData: options.traceData,
      },
      headers,
    );
  }, [sse]);

  const suggest = useCallback(async (options: SuggestOptions, tenantId?: string) => {
    const baseUrl = getApiBaseUrl();
    const headers: Record<string, string> = {};
    if (tenantId) headers['X-Tenant-Id'] = tenantId;

    await sse.startStream(
      `${baseUrl}${API_ENDPOINTS.aiSuggest}`,
      {
        source: options.source,
        locale: options.locale,
        focus: options.focus,
        model: options.model,
      },
      headers,
    );
  }, [sse]);

  return {
    streaming: sse.streaming,
    content: sse.content,
    error: sse.error,
    validationError: sse.validationError,
    completed: sse.completed,
    validated: sse.validated,
    repairProgress: sse.repairProgress,
    generate,
    explain,
    suggest,
    cancel: sse.cancel,
    reset: sse.reset,
  };
}

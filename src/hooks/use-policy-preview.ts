'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  PolicyApiClient,
  PolicyDiagnostic,
  PolicyEvaluateResponse,
  PreviewMessage,
} from '@/services/policy/policy-api';

interface UsePolicyPreviewOptions {
  /** 租户 ID */
  tenantId: string;
  /** 用户 ID */
  userId: string;
  /** 是否使用 WebSocket 实时预览 */
  useWebSocket?: boolean;
  /** debounce 延迟 (毫秒) */
  debounceMs?: number;
}

interface UsePolicyPreviewResult {
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否已连接 WebSocket */
  isConnected: boolean;
  /** 诊断信息 */
  diagnostics: PolicyDiagnostic[];
  /** 预览结果 */
  previewResult: PolicyEvaluateResponse | null;
  /** 错误信息 */
  error: string | null;
  /** 编译策略 */
  compile: (source: string, locale?: string) => Promise<void>;
  /** 评估策略 */
  evaluate: (
    policyModule: string,
    policyFunction: string,
    context: Record<string, unknown>[],
    locale?: string
  ) => Promise<PolicyEvaluateResponse>;
  /** 发送实时预览请求（支持单个对象或数组格式） */
  sendPreview: (source: string, context: Record<string, unknown> | Record<string, unknown>[], locale?: string) => void;
  /** 连接 WebSocket */
  connect: () => void;
  /** 断开 WebSocket */
  disconnect: () => void;
}

/**
 * 策略预览 Hook
 *
 * 提供策略编译、评估和实时预览功能。
 */
export function usePolicyPreview({
  tenantId,
  userId,
  useWebSocket = false,
  debounceMs = 500,
}: UsePolicyPreviewOptions): UsePolicyPreviewResult {
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PolicyDiagnostic[]>([]);
  const [previewResult, setPreviewResult] = useState<PolicyEvaluateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<PolicyApiClient | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 初始化客户端
  useEffect(() => {
    clientRef.current = new PolicyApiClient(tenantId, userId);

    return () => {
      disconnectRef.current?.();
      clientRef.current = null;
    };
  }, [tenantId, userId]);

  // 处理 WebSocket 消息
  const handleMessage = useCallback((message: PreviewMessage) => {
    switch (message.type) {
      case 'preview':
        setPreviewResult(message.data as PolicyEvaluateResponse);
        setIsLoading(false);
        break;
      case 'diagnostics':
        setDiagnostics(message.data as PolicyDiagnostic[]);
        // 诊断消息也应该结束加载状态，避免 UI 永久显示 "加载中"
        setIsLoading(false);
        break;
      case 'error':
        setError(String(message.data));
        setIsLoading(false);
        break;
    }
  }, []);

  // 连接 WebSocket
  const connect = useCallback(() => {
    if (!clientRef.current || !useWebSocket) return;

    disconnectRef.current = clientRef.current.connectPreview(
      handleMessage,
      (err) => {
        setError(err.message);
        setIsConnected(false);
      },
      () => {
        setIsConnected(false);
      },
      // 只有在 WebSocket 真正打开后才设置 isConnected 为 true
      () => {
        setIsConnected(true);
      }
    );
  }, [useWebSocket, handleMessage]);

  // 断开 WebSocket
  const disconnect = useCallback(() => {
    disconnectRef.current?.();
    disconnectRef.current = null;
    setIsConnected(false);
  }, []);

  // 自动连接 WebSocket
  useEffect(() => {
    if (useWebSocket) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [useWebSocket, connect, disconnect]);

  // 编译策略
  const compile = useCallback(async (source: string, locale?: string) => {
    if (!clientRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await clientRef.current.compile({ source, locale });

      if (response.success) {
        setDiagnostics(response.diagnostics || []);
      } else {
        setError(response.error || 'Compilation failed');
        setDiagnostics(response.diagnostics || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 评估策略
  const evaluate = useCallback(async (
    policyModule: string,
    policyFunction: string,
    context: Record<string, unknown>[],
    locale?: string
  ): Promise<PolicyEvaluateResponse> => {
    if (!clientRef.current) {
      throw new Error('Client not initialized');
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await clientRef.current.evaluate({
        policyModule,
        policyFunction,
        context,
        locale,
      });

      setPreviewResult(response);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 发送实时预览请求 (debounced)
  const sendPreview = useCallback((
    source: string,
    context: Record<string, unknown> | Record<string, unknown>[],
    locale?: string
  ) => {
    if (!clientRef.current || !isConnected) return;

    // 清除之前的定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setIsLoading(true);

    // 设置新的定时器
    debounceTimerRef.current = setTimeout(() => {
      clientRef.current?.sendPreview(source, context, locale);
    }, debounceMs);
  }, [isConnected, debounceMs]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    isLoading,
    isConnected,
    diagnostics,
    previewResult,
    error,
    compile,
    evaluate,
    sendPreview,
    connect,
    disconnect,
  };
}

/**
 * 简化版 Hook - 仅用于编译验证
 */
export function usePolicyCompile(tenantId: string, userId: string) {
  const [isLoading, setIsLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PolicyDiagnostic[]>([]);
  const [error, setError] = useState<string | null>(null);

  const compile = useCallback(async (source: string, locale?: string) => {
    const client = new PolicyApiClient(tenantId, userId);

    setIsLoading(true);
    setError(null);
    setDiagnostics([]);

    try {
      const response = await client.compile({ source, locale });
      setDiagnostics(response.diagnostics || []);

      if (!response.success) {
        setError(response.error || 'Compilation failed');
      }

      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, userId]);

  return { isLoading, diagnostics, error, compile };
}

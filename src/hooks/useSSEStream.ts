'use client';

import { useCallback, useRef, useState } from 'react';

export type SSEEventType = 'delta' | 'validation_error' | 'final' | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data?: string;
  error?: string;
}

export interface UseSSEStreamResult {
  streaming: boolean;
  content: string;
  error: string | null;
  validationError: string | null;
  completed: boolean;
  startStream: (url: string, body: object, headers?: Record<string, string>) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/**
 * 解析 SSE text/event-stream 响应中的 JSON 事件行
 *
 * aster-api 返回格式：每行一个 JSON 对象（Quarkus @RestStreamElementType）
 */
function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Quarkus SSE: data: 前缀
  const payload = trimmed.startsWith('data:')
    ? trimmed.slice(5).trim()
    : trimmed;

  if (!payload) return null;

  try {
    return JSON.parse(payload) as SSEEvent;
  } catch {
    // 非 JSON 行（如纯文本 delta），视为 delta 事件
    return { type: 'delta', data: payload };
  }
}

export function useSSEStream(): UseSSEStreamResult {
  const [streaming, setStreaming] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setContent('');
    setError(null);
    setValidationError(null);
    setCompleted(false);
    setStreaming(false);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const startStream = useCallback(async (url: string, body: object, headers?: Record<string, string>) => {
    // 重置状态
    setContent('');
    setError(null);
    setValidationError(null);
    setCompleted(false);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        setError(`HTTP ${response.status}: ${errorText}`);
        setStreaming(false);
        return;
      }

      if (!response.body) {
        setError('Response body is empty');
        setStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 保留最后一行（可能不完整）
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const event = parseSSELine(line);
          if (!event) continue;

          switch (event.type) {
            case 'delta':
              if (event.data) {
                setContent(prev => prev + event.data);
              }
              break;
            case 'final':
              if (event.data) {
                setContent(event.data);
              }
              setCompleted(true);
              break;
            case 'validation_error':
              setValidationError(event.error ?? event.data ?? 'Validation failed');
              break;
            case 'error':
              setError(event.error ?? event.data ?? 'Unknown error');
              break;
          }
        }
      }

      // 处理 buffer 中剩余内容
      if (buffer.trim()) {
        const event = parseSSELine(buffer);
        if (event) {
          if (event.type === 'final' && event.data) setContent(event.data);
          else if (event.type === 'delta' && event.data) setContent(prev => prev + event.data);
          else if (event.type === 'error') setError(event.error ?? event.data ?? 'Unknown error');
        }
      }

      if (!completed) setCompleted(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户取消，不视为错误
      } else {
        setError(err instanceof Error ? err.message : 'Stream failed');
      }
    } finally {
      setStreaming(false);
    }
  }, [completed]);

  return { streaming, content, error, validationError, completed, startStream, cancel, reset };
}

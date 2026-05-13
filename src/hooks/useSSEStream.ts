'use client';

import { useCallback, useRef, useState } from 'react';

export type SSEEventType = 'delta' | 'validation_error' | 'repair_start' | 'final' | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data?: string;
  error?: string;
  validated?: boolean;
}

export interface UseSSEStreamResult {
  streaming: boolean;
  content: string;
  error: string | null;
  validationError: string | null;
  completed: boolean;
  /** 编译是否通过（final 事件携带） */
  validated: boolean;
  /** 当前修复尝试次数（如 "2/5"） */
  repairProgress: string | null;
  startStream: (url: string, body: object, headers?: Record<string, string>) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

/**
 * 解析 SSE text/event-stream 帧到结构化 event。
 *
 * aster-api 同时使用两种格式：
 *   1) 双行 W3C 标准：
 *        event: error
 *        data: {"error":"out_of_scope","message":"...","rule_id":"..."}
 *      解析需按"帧"（两个 \n 分隔）而非按"行"。
 *   2) 单行 Quarkus JSON：
 *        data: {"type":"delta","data":"..."}
 *      此时 type 由 payload 自身携带。
 *
 * 兼容做法：从一段文本中提取 `event:` 行（如有）作为 type override，
 * 把所有 `data:` 行的内容拼接为 payload，再尝试 JSON.parse。
 */
export function parseSSEFrame(frame: string): SSEEvent | null {
  const trimmed = frame.trim();
  if (!trimmed) return null;

  let eventType: SSEEventType | null = null;
  const dataParts: string[] = [];

  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith(':')) continue; // SSE 注释 / 空行
    if (l.startsWith('event:')) {
      const v = l.slice(6).trim();
      if (v === 'delta' || v === 'validation_error' || v === 'repair_start' || v === 'final' || v === 'error') {
        eventType = v;
      }
    } else if (l.startsWith('data:')) {
      dataParts.push(l.slice(5).trim());
    }
  }

  if (dataParts.length === 0) {
    // 既没 event: 也没 data:（或全空），按纯文本 delta 处理
    return eventType ? { type: eventType } : { type: 'delta', data: trimmed };
  }

  const payload = dataParts.join('\n');

  // 尝试 JSON.parse 拿结构化字段
  try {
    const parsed = JSON.parse(payload) as Partial<SSEEvent> & {
      error?: string;
      message?: string;
      rule_id?: string;
    };
    // PromptScopeFilter 返回 { error: "out_of_scope", message: "...", rule_id: "..." }
    // 用 message 作为 user-facing 文案，error 仅作为机器可读的 code
    const userMessage = parsed.message ?? parsed.error;
    return {
      type: eventType ?? parsed.type ?? 'delta',
      data: parsed.data,
      error: userMessage,
      validated: parsed.validated,
    };
  } catch {
    // 非 JSON：当 type 提示是 delta 时拼回 content；否则带 event type 抛错
    if (eventType && eventType !== 'delta') {
      return { type: eventType, error: payload };
    }
    return { type: 'delta', data: payload };
  }
}

export function useSSEStream(): UseSSEStreamResult {
  const [streaming, setStreaming] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [validated, setValidated] = useState(false);
  const [repairProgress, setRepairProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setContent('');
    setError(null);
    setValidationError(null);
    setCompleted(false);
    setValidated(false);
    setRepairProgress(null);
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
    setValidated(false);
    setRepairProgress(null);
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

      const dispatch = (event: SSEEvent) => {
        switch (event.type) {
          case 'delta':
            if (event.data) setContent(prev => prev + event.data);
            break;
          case 'repair_start':
            // 新的修复尝试开始：清空已有内容，显示进度
            setContent('');
            setValidationError(null);
            setRepairProgress(event.data ?? null);
            break;
          case 'final':
            if (event.data) setContent(event.data);
            setValidated(event.validated === true);
            setCompleted(true);
            break;
          case 'validation_error':
            setValidationError(event.error ?? event.data ?? 'Validation failed');
            break;
          case 'error':
            setError(event.error ?? event.data ?? 'Unknown error');
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSE 帧由空行（"\n\n"）分隔。逐帧 split + 保留最后一个不完整 frame。
        const frames = buffer.split(/\n\n/);
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const event = parseSSEFrame(frame);
          if (event) dispatch(event);
        }
      }

      // 处理 buffer 中剩余内容
      if (buffer.trim()) {
        const event = parseSSEFrame(buffer);
        if (event) dispatch(event);
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

  return { streaming, content, error, validationError, completed, validated, repairProgress, startStream, cancel, reset };
}

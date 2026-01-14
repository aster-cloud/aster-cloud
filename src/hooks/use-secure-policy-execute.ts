'use client';

import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

/**
 * 安全执行选项
 */
interface SecureExecuteOptions {
  /** 策略 ID */
  policyId: string;
  /** 策略源码（用于计算哈希） */
  source: string;
  /** 执行参数 */
  input: Record<string, unknown>;
  /** 可选：指定执行版本 */
  version?: number;
}

/**
 * 安全执行结果
 */
interface SecureExecuteResult {
  /** 是否成功 */
  success: boolean;
  /** 执行结果 */
  result?: unknown;
  /** 错误信息 */
  error?: string;
  /** 错误代码 */
  errorCode?: string;
  /** 执行时间（毫秒） */
  executionTimeMs?: number;
  /** 执行的版本号 */
  version?: number;
  /** 源码哈希 */
  sourceHash?: string;
  /** 是否执行的是已废弃版本 */
  isDeprecated?: boolean;
  /** 哈希不匹配时的期望版本 */
  expectedVersion?: number;
  /** 哈希不匹配时的期望哈希 */
  expectedHash?: string;
  /** 请求 ID（用于追踪） */
  requestId?: string;
}

/**
 * Hook 返回类型
 */
interface UseSecurePolicyExecuteResult {
  /** 执行策略 */
  execute: (options: SecureExecuteOptions) => Promise<SecureExecuteResult>;
  /** 是否正在执行 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 最近一次执行结果 */
  lastResult: SecureExecuteResult | null;
}

// 注意：在生产环境中，签名应该在后端完成（BFF 模式）
// 这里的实现仅用于演示，实际部署时应使用服务端签名
const SIGNING_SECRET = process.env.NEXT_PUBLIC_POLICY_SIGNING_SECRET || '';

/**
 * 安全策略执行 Hook
 *
 * 实现基于签名验证的策略执行：
 * 1. 计算源码 SHA-256 哈希
 * 2. 生成时间戳和 Nonce
 * 3. 生成 HMAC-SHA256 签名
 * 4. 发送安全执行请求
 *
 * 注意：生产环境中签名应在 BFF 层完成，避免在前端暴露密钥。
 */
export function useSecurePolicyExecute(): UseSecurePolicyExecuteResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SecureExecuteResult | null>(null);

  const execute = useCallback(
    async (options: SecureExecuteOptions): Promise<SecureExecuteResult> => {
      setLoading(true);
      setError(null);

      try {
        // 1. 计算源码哈希
        const hash = await computeHashInBrowser(options.source);

        // 2. 生成请求参数
        const timestamp = Date.now();
        const nonce = uuidv4();

        // 3. 生成签名（生产环境应在 BFF 层完成）
        const signature = await signRequestInBrowser({
          policyId: options.policyId,
          hash,
          input: options.input,
          timestamp,
          nonce,
          version: options.version,
        });

        // 4. 发送请求
        const response = await fetch(
          `/api/v1/policies/${options.policyId}/secure-execute`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              hash,
              input: options.input,
              timestamp,
              nonce,
              signature,
              version: options.version,
            }),
          }
        );

        const result: SecureExecuteResult = await response.json();

        if (!result.success) {
          setError(result.error || '执行失败');
        }

        setLastResult(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知错误';
        setError(message);
        const errorResult: SecureExecuteResult = { success: false, error: message };
        setLastResult(errorResult);
        return errorResult;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { execute, loading, error, lastResult };
}

/**
 * 在浏览器中计算 SHA-256 哈希
 */
async function computeHashInBrowser(source: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(source);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
}

/**
 * 在浏览器中生成 HMAC-SHA256 签名
 *
 * 注意：生产环境中不应在前端执行签名，这会暴露密钥。
 * 应使用 BFF 模式，在服务端完成签名。
 */
async function signRequestInBrowser(payload: {
  policyId: string;
  hash: string;
  input: unknown;
  timestamp: number;
  nonce: string;
  version?: number;
}): Promise<string> {
  const data = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const keyData = encoder.encode(SIGNING_SECRET);
  const messageData = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', key, messageData);
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const signatureHex = signatureArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `hmac-sha256:${signatureHex}`;
}

export type {
  SecureExecuteOptions,
  SecureExecuteResult,
  UseSecurePolicyExecuteResult,
};

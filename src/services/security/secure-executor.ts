/**
 * 安全执行服务 - 策略安全执行器
 *
 * 实现策略执行的安全验证流程：
 * 1. 验证签名
 * 2. 验证时间戳
 * 3. 验证 Nonce（防重放）
 * 4. 获取目标版本（指定版本 或 默认版本 或 最新批准版本）
 * 5. 验证哈希匹配
 * 6. 执行策略（使用数据库中的源码）
 *
 * 遵循零信任原则：不信任任何客户端提供的源码。
 */

import { prisma } from '@/lib/prisma';
import type { Policy, PolicyVersion, PolicyVersionStatus } from '@prisma/client';
import {
  verifySignature,
  validateTimestamp,
  type SignedRequest,
} from './policy-security';
import { checkAndRecordNonce } from './nonce-service';
import { logSecurityEvent } from './security-event-service';
import { createPolicyApiClient } from '../policy/policy-api';

export interface SecureExecuteOptions {
  request: SignedRequest;
  userId: string;
  tenantId: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface SecureExecuteResult {
  success: boolean;
  result?: unknown;
  error?: string;
  errorCode?: SecurityErrorCode;
  executionTimeMs?: number;
  version?: number;
  sourceHash?: string;
  isDeprecated?: boolean;
  expectedVersion?: number;
  expectedHash?: string;
}

export type SecurityErrorCode =
  | 'SIGNATURE_INVALID'
  | 'NONCE_REUSED'
  | 'NONCE_INVALID'
  | 'TIMESTAMP_EXPIRED'
  | 'HASH_MISMATCH'
  | 'POLICY_NOT_FOUND'
  | 'NO_APPROVED_VERSION'
  | 'VERSION_NOT_EXECUTABLE'
  | 'EXECUTION_FAILED';

const SIGNING_SECRET = process.env.POLICY_SIGNING_SECRET || '';

type PolicyVersionWithPolicy = PolicyVersion & {
  policy: Policy;
};

/**
 * 安全执行策略（支持多版本共存）
 *
 * 多版本执行规则：
 * - 如果请求包含 version 字段：执行指定版本（必须是 APPROVED 或 DEPRECATED）
 * - 如果未指定版本：优先执行 isDefault=true 的版本，否则执行最新批准版本
 * - DEPRECATED 版本仍可执行，但会记录警告日志
 * - ARCHIVED 版本不可执行
 */
export async function executeSecurely(
  options: SecureExecuteOptions
): Promise<SecureExecuteResult> {
  const { request, userId, tenantId, ipAddress, userAgent, requestId } = options;
  const eventContext = {
    policyId: request.policyId,
    userId,
    ipAddress,
    userAgent,
    requestId,
  };

  // 1. 验证签名
  if (!verifySignature(request, SIGNING_SECRET)) {
    await logSecurityEvent({
      ...eventContext,
      eventType: 'SIGNATURE_INVALID',
      severity: 'ERROR',
      details: {
        providedSignature: request.signature.substring(0, 20) + '...',
      },
    });
    return {
      success: false,
      error: '请求签名无效',
      errorCode: 'SIGNATURE_INVALID',
    };
  }

  // 2. 验证时间戳
  if (!validateTimestamp(request.timestamp)) {
    await logSecurityEvent({
      ...eventContext,
      eventType: 'TIMESTAMP_EXPIRED',
      severity: 'WARNING',
      details: {
        providedTimestamp: request.timestamp,
        serverTime: Date.now(),
      },
    });
    return {
      success: false,
      error: '请求时间戳已过期',
      errorCode: 'TIMESTAMP_EXPIRED',
    };
  }

  // 3. 验证 Nonce（防重放）
  const nonceResult = await checkAndRecordNonce(
    request.nonce,
    request.policyId,
    userId
  );
  if (!nonceResult.valid) {
    await logSecurityEvent({
      ...eventContext,
      eventType: 'NONCE_REUSED',
      severity: 'ERROR',
      details: { nonce: request.nonce, reason: nonceResult.reason },
    });
    return {
      success: false,
      error:
        nonceResult.reason === 'ALREADY_USED'
          ? 'Nonce 已被使用'
          : 'Nonce 格式无效',
      errorCode:
        nonceResult.reason === 'ALREADY_USED' ? 'NONCE_REUSED' : 'NONCE_INVALID',
    };
  }

  // 4. 获取目标版本（支持多版本共存）
  let targetVersion: PolicyVersionWithPolicy | null = null;
  let isDeprecated = false;

  if (request.version !== undefined) {
    // 4a. 指定版本执行
    targetVersion = (await prisma.policyVersion.findFirst({
      where: {
        policyId: request.policyId,
        version: request.version,
        status: { in: ['APPROVED', 'DEPRECATED'] as PolicyVersionStatus[] },
      },
      include: { policy: true },
    })) as PolicyVersionWithPolicy | null;

    if (!targetVersion) {
      await logSecurityEvent({
        ...eventContext,
        eventType: 'VERSION_NOT_FOUND',
        severity: 'WARNING',
        details: { requestedVersion: request.version },
      });
      return {
        success: false,
        error: `版本 v${request.version} 不存在或不可执行（仅 APPROVED/DEPRECATED 状态可执行）`,
        errorCode: 'VERSION_NOT_EXECUTABLE',
      };
    }

    // 如果是已废弃版本，记录警告
    if (targetVersion.status === 'DEPRECATED') {
      isDeprecated = true;
      await logSecurityEvent({
        ...eventContext,
        eventType: 'DEPRECATED_VERSION_EXECUTED',
        severity: 'WARNING',
        details: {
          version: request.version,
          deprecatedAt: targetVersion.deprecatedAt,
          deprecatedBy: targetVersion.deprecatedBy,
        },
      });
    }
  } else {
    // 4b. 默认版本执行：优先 isDefault，否则最新批准
    targetVersion = (await prisma.policyVersion.findFirst({
      where: {
        policyId: request.policyId,
        status: 'APPROVED' as PolicyVersionStatus,
        isDefault: true,
      },
      include: { policy: true },
    })) as PolicyVersionWithPolicy | null;

    if (!targetVersion) {
      // 没有默认版本，取最新批准版本
      targetVersion = (await prisma.policyVersion.findFirst({
        where: {
          policyId: request.policyId,
          status: 'APPROVED' as PolicyVersionStatus,
        },
        orderBy: { version: 'desc' },
        include: { policy: true },
      })) as PolicyVersionWithPolicy | null;
    }

    if (!targetVersion) {
      return {
        success: false,
        error: '未找到可执行的策略版本',
        errorCode: 'NO_APPROVED_VERSION',
      };
    }
  }

  // 5. 验证哈希匹配
  const expectedHash = targetVersion.sourceHash;
  if (request.hash !== expectedHash) {
    await logSecurityEvent({
      ...eventContext,
      eventType: 'HASH_MISMATCH',
      severity: 'ERROR',
      details: {
        requestedHash: request.hash,
        expectedHash: expectedHash,
        requestedVersion: request.version,
        actualVersion: targetVersion.version,
      },
    });
    return {
      success: false,
      error:
        request.version !== undefined
          ? `版本 v${request.version} 的哈希不匹配`
          : '策略哈希不匹配，请刷新页面获取最新版本',
      errorCode: 'HASH_MISMATCH',
      expectedVersion: targetVersion.version,
      expectedHash: expectedHash ?? undefined,
    };
  }

  // 6. 执行策略（使用数据库中的源码，不使用请求中的任何源码）
  const startTime = Date.now();
  try {
    // 获取源码：优先使用 source 字段，兼容旧版本使用 content 字段
    const sourceCode = targetVersion.source ?? targetVersion.content;

    if (!sourceCode) {
      throw new Error('策略源码不存在');
    }

    const apiClient = createPolicyApiClient(tenantId, userId);
    const response = await apiClient.evaluateSource(
      sourceCode, // 关键：使用数据库中的源码
      request.input as Record<string, unknown>
    );

    const executionTimeMs = Date.now() - startTime;

    await logSecurityEvent({
      ...eventContext,
      eventType: 'POLICY_EXECUTED',
      severity: 'INFO',
      details: {
        version: targetVersion.version,
        isDeprecated,
        executionTimeMs,
        success: !response.error,
      },
    });

    return {
      success: !response.error,
      result: response.result,
      error: response.error ?? undefined,
      executionTimeMs,
      version: targetVersion.version,
      sourceHash: targetVersion.sourceHash ?? undefined,
      isDeprecated,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;

    await logSecurityEvent({
      ...eventContext,
      eventType: 'POLICY_EXECUTED',
      severity: 'ERROR',
      details: {
        version: targetVersion.version,
        executionTimeMs,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return {
      success: false,
      error: '策略执行失败',
      errorCode: 'EXECUTION_FAILED',
      executionTimeMs,
    };
  }
}

/**
 * 获取策略的可执行版本列表
 *
 * 返回所有 APPROVED 和 DEPRECATED 状态的版本，
 * 用于前端展示版本选择器。
 */
export async function getExecutableVersions(policyId: string): Promise<
  Array<{
    version: number;
    sourceHash: string | null;
    status: PolicyVersionStatus;
    isDefault: boolean;
    releaseNote: string | null;
    createdAt: Date;
    deprecatedAt: Date | null;
  }>
> {
  const versions = await prisma.policyVersion.findMany({
    where: {
      policyId,
      status: { in: ['APPROVED', 'DEPRECATED'] as PolicyVersionStatus[] },
    },
    select: {
      version: true,
      sourceHash: true,
      status: true,
      isDefault: true,
      releaseNote: true,
      createdAt: true,
      deprecatedAt: true,
    },
    orderBy: { version: 'desc' },
  });

  return versions;
}

/**
 * 获取策略的默认版本信息
 *
 * 用于前端初始加载时获取默认执行版本的哈希。
 */
export async function getDefaultVersionInfo(policyId: string): Promise<{
  version: number;
  sourceHash: string;
  source: string;
} | null> {
  // 优先获取默认版本
  let version = await prisma.policyVersion.findFirst({
    where: {
      policyId,
      status: 'APPROVED' as PolicyVersionStatus,
      isDefault: true,
    },
    select: {
      version: true,
      sourceHash: true,
      source: true,
      content: true,
    },
  });

  // 没有默认版本则获取最新批准版本
  if (!version) {
    version = await prisma.policyVersion.findFirst({
      where: {
        policyId,
        status: 'APPROVED' as PolicyVersionStatus,
      },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        sourceHash: true,
        source: true,
        content: true,
      },
    });
  }

  if (!version || !version.sourceHash) {
    return null;
  }

  return {
    version: version.version,
    sourceHash: version.sourceHash,
    source: version.source ?? version.content,
  };
}

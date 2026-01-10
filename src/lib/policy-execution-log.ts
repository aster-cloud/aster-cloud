// src/lib/policy-execution-log.ts
// 策略执行日志服务：查询、分页、统计

import { prisma } from '@/lib/prisma';
import { ExecutionSource } from '@prisma/client';

export interface ExecutionLogItem {
  id: string;
  policyId: string;
  policyName: string;
  policyVersion: number | null;
  input: unknown;
  output: unknown;
  error: string | null;
  success: boolean;
  durationMs: number;
  source: ExecutionSource;
  metadata: unknown;
  createdAt: Date;
}

export interface ExecutionLogQuery {
  userId: string;
  policyId?: string;
  success?: boolean;
  source?: ExecutionSource;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

export interface ExecutionLogResult {
  items: ExecutionLogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ExecutionStats {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
  bySource: {
    source: ExecutionSource;
    count: number;
  }[];
  recentTrend: {
    date: string;
    successCount: number;
    failureCount: number;
  }[];
}

/**
 * 查询执行日志（分页）
 */
export async function queryExecutionLogs(query: ExecutionLogQuery): Promise<ExecutionLogResult> {
  const { userId, policyId, success, source, startDate, endDate, page = 1, pageSize = 20 } = query;

  const where: {
    userId: string;
    policyId?: string;
    success?: boolean;
    source?: ExecutionSource;
    createdAt?: { gte?: Date; lte?: Date };
    policy?: { deletedAt: null };
  } = {
    userId,
    policy: { deletedAt: null }, // 排除已删除策略的执行记录
  };

  if (policyId) where.policyId = policyId;
  if (success !== undefined) where.success = success;
  if (source) where.source = source;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startDate;
    if (endDate) where.createdAt.lte = endDate;
  }

  const [items, total] = await Promise.all([
    prisma.execution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        policy: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.execution.count({ where }),
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      policyId: item.policyId,
      policyName: item.policy.name,
      policyVersion: item.policyVersion,
      input: item.input,
      output: item.output,
      error: item.error,
      success: item.success,
      durationMs: item.durationMs,
      source: item.source,
      metadata: item.metadata,
      createdAt: item.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 获取单个执行日志详情
 */
export async function getExecutionLogDetail(
  executionId: string,
  userId: string
): Promise<ExecutionLogItem | null> {
  const item = await prisma.execution.findFirst({
    where: {
      id: executionId,
      userId,
    },
    include: {
      policy: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!item) return null;

  return {
    id: item.id,
    policyId: item.policyId,
    policyName: item.policy.name,
    policyVersion: item.policyVersion,
    input: item.input,
    output: item.output,
    error: item.error,
    success: item.success,
    durationMs: item.durationMs,
    source: item.source,
    metadata: item.metadata,
    createdAt: item.createdAt,
  };
}

/**
 * 获取策略执行统计
 */
export async function getExecutionStats(
  userId: string,
  policyId?: string,
  days: number = 30
): Promise<ExecutionStats> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const where: {
    userId: string;
    policyId?: string;
    createdAt: { gte: Date };
    policy?: { deletedAt: null };
  } = {
    userId,
    createdAt: { gte: startDate },
    policy: { deletedAt: null },
  };

  if (policyId) where.policyId = policyId;

  // 基础统计
  const [totalExecutions, successCount, executions] = await Promise.all([
    prisma.execution.count({ where }),
    prisma.execution.count({ where: { ...where, success: true } }),
    prisma.execution.findMany({
      where,
      select: {
        success: true,
        durationMs: true,
        source: true,
        createdAt: true,
      },
    }),
  ]);

  const failureCount = totalExecutions - successCount;
  const successRate = totalExecutions > 0 ? (successCount / totalExecutions) * 100 : 0;
  const avgDurationMs =
    executions.length > 0
      ? executions.reduce((sum, e) => sum + e.durationMs, 0) / executions.length
      : 0;

  // 按来源统计
  const sourceStats = new Map<ExecutionSource, number>();
  for (const exec of executions) {
    sourceStats.set(exec.source, (sourceStats.get(exec.source) || 0) + 1);
  }
  const bySource = Array.from(sourceStats.entries()).map(([source, count]) => ({
    source,
    count,
  }));

  // 最近 7 天趋势
  const trendDays = Math.min(days, 7);
  const trendMap = new Map<string, { successCount: number; failureCount: number }>();

  for (let i = 0; i < trendDays; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    trendMap.set(dateStr, { successCount: 0, failureCount: 0 });
  }

  for (const exec of executions) {
    const dateStr = exec.createdAt.toISOString().slice(0, 10);
    if (trendMap.has(dateStr)) {
      const trend = trendMap.get(dateStr)!;
      if (exec.success) {
        trend.successCount++;
      } else {
        trend.failureCount++;
      }
    }
  }

  const recentTrend = Array.from(trendMap.entries())
    .map(([date, counts]) => ({
      date,
      ...counts,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalExecutions,
    successCount,
    failureCount,
    successRate: Math.round(successRate * 100) / 100,
    avgDurationMs: Math.round(avgDurationMs),
    bySource,
    recentTrend,
  };
}

/**
 * 获取策略的最近执行记录
 */
export async function getRecentExecutions(
  policyId: string,
  userId: string,
  limit: number = 10
): Promise<ExecutionLogItem[]> {
  const items = await prisma.execution.findMany({
    where: {
      policyId,
      userId,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      policy: {
        select: {
          name: true,
        },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    policyId: item.policyId,
    policyName: item.policy.name,
    policyVersion: item.policyVersion,
    input: item.input,
    output: item.output,
    error: item.error,
    success: item.success,
    durationMs: item.durationMs,
    source: item.source,
    metadata: item.metadata,
    createdAt: item.createdAt,
  }));
}

/**
 * 创建执行日志（增强版）
 */
export async function createExecutionLog(data: {
  userId: string;
  policyId: string;
  policyVersion?: number;
  input: unknown;
  output?: unknown;
  error?: string;
  success: boolean;
  durationMs: number;
  source: ExecutionSource;
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    apiKeyId?: string;
    [key: string]: unknown;
  };
}): Promise<string> {
  const execution = await prisma.execution.create({
    data: {
      userId: data.userId,
      policyId: data.policyId,
      policyVersion: data.policyVersion,
      input: data.input as object,
      output: data.output as object | undefined,
      error: data.error,
      success: data.success,
      durationMs: data.durationMs,
      source: data.source,
      apiKeyId: data.metadata?.apiKeyId as string | undefined,
      metadata: data.metadata as object | undefined,
    },
  });

  return execution.id;
}

/**
 * 删除旧的执行日志（保留最近 N 天）
 * 应由定时任务调用
 */
export async function cleanupOldExecutionLogs(
  retentionDays: number = 90
): Promise<{ deletedCount: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await prisma.execution.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  return { deletedCount: result.count };
}

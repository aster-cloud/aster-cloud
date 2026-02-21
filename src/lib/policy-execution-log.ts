// src/lib/policy-execution-log.ts
// 策略执行日志服务：查询、分页、统计

import { db, executions } from '@/lib/prisma';
import { eq, and, gte, lte, desc, lt, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

type ExecutionSource = InferSelectModel<typeof executions>['source'];

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

  // Build where conditions
  const conditions = [eq(executions.userId, userId)];
  if (policyId) conditions.push(eq(executions.policyId, policyId));
  if (success !== undefined) conditions.push(eq(executions.success, success));
  if (source) conditions.push(eq(executions.source, source));
  if (startDate) conditions.push(gte(executions.createdAt, startDate));
  if (endDate) conditions.push(lte(executions.createdAt, endDate));

  const whereClause = and(...conditions);

  const [items, totalResult] = await Promise.all([
    db.query.executions.findMany({
      where: whereClause,
      orderBy: [desc(executions.createdAt)],
      offset: (page - 1) * pageSize,
      limit: pageSize,
      with: {
        policy: {
          columns: {
            name: true,
            deletedAt: true,
          },
        },
      },
    }),
    db.select({ count: sql<number>`count(*)::int` })
      .from(executions)
      .where(whereClause),
  ]);

  const total = totalResult[0]?.count || 0;

  // Filter out executions with deleted policies
  const filteredItems = items.filter(item => !item.policy.deletedAt);

  return {
    items: filteredItems.map((item) => ({
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
  const item = await db.query.executions.findFirst({
    where: and(
      eq(executions.id, executionId),
      eq(executions.userId, userId)
    ),
    with: {
      policy: {
        columns: {
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

  // Build where conditions
  const conditions = [
    eq(executions.userId, userId),
    gte(executions.createdAt, startDate),
  ];
  if (policyId) conditions.push(eq(executions.policyId, policyId));

  const whereClause = and(...conditions);
  const whereWithSuccess = and(...conditions, eq(executions.success, true));

  // 基础统计
  const [totalResult, successResult, executionsList] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(executions)
      .where(whereClause),
    db.select({ count: sql<number>`count(*)::int` })
      .from(executions)
      .where(whereWithSuccess),
    db.query.executions.findMany({
      where: whereClause,
      columns: {
        success: true,
        durationMs: true,
        source: true,
        createdAt: true,
      },
      with: {
        policy: {
          columns: {
            deletedAt: true,
          },
        },
      },
    }),
  ]);

  const totalExecutions = totalResult[0]?.count || 0;
  const successCount = successResult[0]?.count || 0;
  // Filter out executions with deleted policies
  const executionData = executionsList.filter(e => !e.policy.deletedAt);

  const failureCount = totalExecutions - successCount;
  const successRate = totalExecutions > 0 ? (successCount / totalExecutions) * 100 : 0;
  const avgDurationMs =
    executionData.length > 0
      ? executionData.reduce((sum, e) => sum + e.durationMs, 0) / executionData.length
      : 0;

  // 按来源统计
  const sourceStats = new Map<ExecutionSource, number>();
  for (const exec of executionData) {
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

  for (const exec of executionData) {
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
  const items = await db.query.executions.findMany({
    where: and(
      eq(executions.policyId, policyId),
      eq(executions.userId, userId)
    ),
    orderBy: [desc(executions.createdAt)],
    limit,
    with: {
      policy: {
        columns: {
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
  const [execution] = await db.insert(executions).values({
    id: crypto.randomUUID(),
    userId: data.userId,
    policyId: data.policyId,
    policyVersion: data.policyVersion ?? null,
    input: data.input as object,
    output: (data.output as object | null) ?? null,
    error: data.error ?? null,
    success: data.success,
    durationMs: data.durationMs,
    source: data.source,
    apiKeyId: (data.metadata?.apiKeyId as string | null) ?? null,
    metadata: (data.metadata as object | null) ?? null,
  }).returning();

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

  const result = await db.delete(executions)
    .where(lt(executions.createdAt, cutoffDate))
    .returning();

  return { deletedCount: result.length };
}

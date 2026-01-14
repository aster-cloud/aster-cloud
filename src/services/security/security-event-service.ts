/**
 * 安全事件服务 - 审计日志
 *
 * 记录所有安全相关事件，用于审计、监控和合规。
 * 事件记录失败不会影响主业务流程。
 */

import { prisma } from '@/lib/prisma';
import type { SecurityEventType, EventSeverity, Prisma } from '@prisma/client';

export interface SecurityEventData {
  eventType: SecurityEventType;
  severity: EventSeverity;
  policyId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  details: Record<string, unknown>;
}

export interface SecurityEventQueryOptions {
  startDate?: Date;
  endDate?: Date;
  eventTypes?: SecurityEventType[];
  severities?: EventSeverity[];
  policyId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

/**
 * 记录安全事件
 *
 * 安全事件记录是异步的，失败不会影响主流程。
 * 生产环境建议配合消息队列实现可靠投递。
 */
export async function logSecurityEvent(data: SecurityEventData): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        eventType: data.eventType,
        severity: data.severity,
        policyId: data.policyId,
        userId: data.userId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        requestId: data.requestId,
        details: data.details as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // 安全事件记录失败不应影响主流程
    console.error('[SecurityEvent] Failed to log event:', error);
  }
}

/**
 * 批量记录安全事件
 *
 * 用于高吞吐场景，减少数据库往返次数。
 */
export async function logSecurityEventsBatch(
  events: SecurityEventData[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  try {
    const result = await prisma.securityEvent.createMany({
      data: events.map((e) => ({
        eventType: e.eventType,
        severity: e.severity,
        policyId: e.policyId,
        userId: e.userId,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        requestId: e.requestId,
        details: e.details as Prisma.InputJsonValue,
      })),
    });
    success = result.count;
  } catch (error) {
    console.error('[SecurityEvent] Batch insert failed:', error);
    failed = events.length;
  }

  return { success, failed };
}

/**
 * 查询安全事件（用于审计导出）
 */
export async function getSecurityEvents(
  options: SecurityEventQueryOptions
): Promise<{
  events: Awaited<ReturnType<typeof prisma.securityEvent.findMany>>;
  total: number;
}> {
  const where: Record<string, unknown> = {};

  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) {
      (where.createdAt as Record<string, unknown>).gte = options.startDate;
    }
    if (options.endDate) {
      (where.createdAt as Record<string, unknown>).lte = options.endDate;
    }
  }

  if (options.eventTypes?.length) {
    where.eventType = { in: options.eventTypes };
  }

  if (options.severities?.length) {
    where.severity = { in: options.severities };
  }

  if (options.policyId) {
    where.policyId = options.policyId;
  }

  if (options.userId) {
    where.userId = options.userId;
  }

  const [events, total] = await Promise.all([
    prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 100,
      skip: options.offset ?? 0,
    }),
    prisma.securityEvent.count({ where }),
  ]);

  return { events, total };
}

/**
 * 获取安全事件统计（用于监控仪表盘）
 */
export async function getSecurityEventStats(options: {
  startDate: Date;
  endDate: Date;
  policyId?: string;
}): Promise<{
  total: number;
  bySeverity: Record<EventSeverity, number>;
  byType: Record<string, number>;
  errorRate: number;
}> {
  const where: Record<string, unknown> = {
    createdAt: {
      gte: options.startDate,
      lte: options.endDate,
    },
  };

  if (options.policyId) {
    where.policyId = options.policyId;
  }

  const [total, bySeverityData, byTypeData] = await Promise.all([
    prisma.securityEvent.count({ where }),
    prisma.securityEvent.groupBy({
      by: ['severity'],
      where,
      _count: { severity: true },
    }),
    prisma.securityEvent.groupBy({
      by: ['eventType'],
      where,
      _count: { eventType: true },
    }),
  ]);

  const bySeverity = {
    INFO: 0,
    WARNING: 0,
    ERROR: 0,
    CRITICAL: 0,
  } as Record<EventSeverity, number>;

  for (const item of bySeverityData) {
    bySeverity[item.severity] = item._count.severity;
  }

  const byType: Record<string, number> = {};
  for (const item of byTypeData) {
    byType[item.eventType] = item._count.eventType;
  }

  const errorCount = bySeverity.ERROR + bySeverity.CRITICAL;
  const errorRate = total > 0 ? errorCount / total : 0;

  return {
    total,
    bySeverity,
    byType,
    errorRate,
  };
}

/**
 * 清理旧的安全事件（用于数据保留策略）
 *
 * 注意：删除前应确保已导出到长期存储。
 */
export async function cleanupOldSecurityEvents(
  olderThan: Date
): Promise<number> {
  const result = await prisma.securityEvent.deleteMany({
    where: {
      createdAt: {
        lt: olderThan,
      },
    },
  });
  return result.count;
}

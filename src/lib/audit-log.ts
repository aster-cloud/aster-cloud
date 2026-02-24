/**
 * 审计日志辅助库
 *
 * 为高风险操作提供结构化审计日志记录。
 * 所有操作自动记录用户 ID、时间戳和上下文信息。
 */

import { db, auditLogs } from '@/lib/prisma';

export type AuditAction =
  | 'policy.create'
  | 'policy.update'
  | 'policy.delete'
  | 'policy.execute'
  | 'policy.publish'
  | 'policy.archive'
  | 'team.create'
  | 'team.member.add'
  | 'team.member.remove'
  | 'team.transfer'
  | 'subscription.upgrade'
  | 'subscription.downgrade'
  | 'subscription.cancelled'
  | 'api-key.create'
  | 'api-key.revoke'
  | 'user.delete'
  | 'settings.update'
  | 'payment.succeeded'
  | 'payment.failed';

interface AuditEntry {
  userId: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  teamId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * 记录审计日志
 */
export async function logAuditEvent(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: globalThis.crypto.randomUUID(),
      userId: entry.userId,
      teamId: entry.teamId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    });
  } catch (error) {
    // 审计日志写入失败不应阻断主流程
    console.error('Failed to write audit log:', error);
  }
}

/**
 * 从请求中提取客户端信息
 */
export function extractClientInfo(request: Request): {
  ipAddress: string | undefined;
  userAgent: string | undefined;
} {
  return {
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('cf-connecting-ip') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  };
}

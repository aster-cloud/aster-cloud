/**
 * Nonce 服务 - 防重放攻击
 *
 * 使用一次性 Nonce 防止请求重放攻击。
 * 每个 Nonce 只能使用一次，过期后自动清理。
 */

import { db, usedNonces } from '@/lib/prisma';
import { lt, sql } from 'drizzle-orm';

const NONCE_EXPIRY_MS = 10 * 60 * 1000; // 10 分钟

export interface NonceCheckResult {
  valid: boolean;
  reason?: 'ALREADY_USED' | 'INVALID_FORMAT';
}

/**
 * 检查并记录 Nonce（原子操作）
 *
 * 使用数据库唯一约束保证原子性：
 * - 如果 Nonce 已存在，创建会失败（重放攻击）
 * - 如果 Nonce 不存在，创建成功并记录
 */
export async function checkAndRecordNonce(
  nonce: string,
  policyId?: string,
  userId?: string
): Promise<NonceCheckResult> {
  // 验证 Nonce 格式（UUID v4）
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidV4Regex.test(nonce)) {
    return { valid: false, reason: 'INVALID_FORMAT' };
  }

  const expiresAt = new Date(Date.now() + NONCE_EXPIRY_MS);

  try {
    // 尝试创建 Nonce 记录（唯一约束保证原子性）
    await db.insert(usedNonces).values({
      id: crypto.randomUUID(),
      nonce,
      policyId,
      userId,
      expiresAt,
    });
    return { valid: true };
  } catch (error: unknown) {
    // 唯一约束冲突 = Nonce 已被使用
    if (isUniqueConstraintError(error)) {
      return { valid: false, reason: 'ALREADY_USED' };
    }
    throw error;
  }
}

/**
 * 清理过期的 Nonce 记录
 *
 * 应通过 Cron 任务定期调用（建议每 5 分钟）。
 * 返回清理的记录数。
 */
export async function cleanupExpiredNonces(): Promise<number> {
  const result = await db.delete(usedNonces)
    .where(lt(usedNonces.expiresAt, new Date()))
    .returning();

  return result.length;
}

/**
 * 获取 Nonce 统计信息（用于监控）
 */
export async function getNonceStats(): Promise<{
  total: number;
  expired: number;
  active: number;
}> {
  const now = new Date();

  const [totalResult, expiredResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(usedNonces),
    db.select({ count: sql<number>`count(*)::int` })
      .from(usedNonces)
      .where(lt(usedNonces.expiresAt, now)),
  ]);

  const total = totalResult[0]?.count || 0;
  const expired = expiredResult[0]?.count || 0;

  return {
    total,
    expired,
    active: total - expired,
  };
}

/**
 * 检查是否为唯一约束错误 (PostgreSQL error code 23505)
 */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}

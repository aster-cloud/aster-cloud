/**
 * Nonce 清理定时任务
 *
 * 定期清理过期的 Nonce 记录，防止数据库无限增长。
 * 建议每 5 分钟运行一次。
 */

import { cleanupExpiredNonces, getNonceStats } from '@/services/security/nonce-service';

/**
 * 清理过期的 Nonce 记录
 *
 * @returns 清理结果
 */
export async function cleanupNoncesJob(): Promise<{
  deletedCount: number;
  stats: { total: number; expired: number; active: number };
}> {
  console.log('[Cron] Starting nonce cleanup...');

  try {
    // 获取清理前的统计信息
    const statsBefore = await getNonceStats();
    console.log(
      `[Cron] Before cleanup: total=${statsBefore.total}, expired=${statsBefore.expired}, active=${statsBefore.active}`
    );

    // 执行清理
    const deletedCount = await cleanupExpiredNonces();
    console.log(`[Cron] Cleaned up ${deletedCount} expired nonces`);

    // 获取清理后的统计信息
    const statsAfter = await getNonceStats();
    console.log(
      `[Cron] After cleanup: total=${statsAfter.total}, active=${statsAfter.active}`
    );

    return {
      deletedCount,
      stats: statsAfter,
    };
  } catch (error) {
    console.error('[Cron] Nonce cleanup failed:', error);
    throw error;
  }
}

/**
 * 健康检查：确保 Nonce 表没有过多积压
 *
 * @param maxActive 最大允许的活跃 Nonce 数量
 * @returns 是否健康
 */
export async function checkNonceHealth(maxActive: number = 100000): Promise<{
  healthy: boolean;
  stats: { total: number; expired: number; active: number };
  message: string;
}> {
  const stats = await getNonceStats();

  const healthy = stats.active <= maxActive;
  const message = healthy
    ? `Nonce count is within limits (${stats.active}/${maxActive})`
    : `Warning: Nonce count exceeds threshold (${stats.active}/${maxActive})`;

  return { healthy, stats, message };
}

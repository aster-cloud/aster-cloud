/**
 * 账户锁定服务
 *
 * 防止暴力破解攻击，在连续登录失败后锁定账户。
 * 使用渐进式锁定策略：失败次数越多，锁定时间越长。
 */

import { prisma } from './prisma';

/**
 * 锁定配置
 */
export const LOCKOUT_CONFIG = {
  /** 最大失败尝试次数 */
  MAX_FAILED_ATTEMPTS: 5,
  /** 失败计数重置时间（毫秒）- 30分钟 */
  FAILED_ATTEMPT_WINDOW_MS: 30 * 60 * 1000,
  /** 基础锁定时长（毫秒）- 15分钟 */
  BASE_LOCKOUT_DURATION_MS: 15 * 60 * 1000,
  /** 最大锁定时长（毫秒）- 24小时 */
  MAX_LOCKOUT_DURATION_MS: 24 * 60 * 60 * 1000,
  /** 锁定时长倍增因子 */
  LOCKOUT_MULTIPLIER: 2,
} as const;

export interface LockoutStatus {
  /** 账户是否被锁定 */
  locked: boolean;
  /** 剩余失败尝试次数 */
  remainingAttempts: number;
  /** 锁定解除时间（如果被锁定） */
  lockedUntil?: Date;
  /** 锁定剩余秒数（如果被锁定） */
  lockoutSecondsRemaining?: number;
}

export interface FailedAttemptResult {
  /** 账户现在是否被锁定 */
  nowLocked: boolean;
  /** 剩余失败尝试次数 */
  remainingAttempts: number;
  /** 如果被锁定，锁定解除时间 */
  lockedUntil?: Date;
  /** 如果被锁定，锁定时长（秒） */
  lockoutDurationSeconds?: number;
}

/**
 * 检查账户锁定状态
 *
 * @param email 用户邮箱
 * @returns 锁定状态信息
 */
export async function checkAccountLockout(email: string): Promise<LockoutStatus> {
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date();

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        failedLoginAttempts: true,
        lastFailedLoginAt: true,
        lockedUntil: true,
      },
    });

    if (!user) {
      // 用户不存在时返回正常状态（避免用户枚举）
      return {
        locked: false,
        remainingAttempts: LOCKOUT_CONFIG.MAX_FAILED_ATTEMPTS,
      };
    }

    // 检查是否处于锁定期
    if (user.lockedUntil && user.lockedUntil > now) {
      const lockoutSecondsRemaining = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      return {
        locked: true,
        remainingAttempts: 0,
        lockedUntil: user.lockedUntil,
        lockoutSecondsRemaining,
      };
    }

    // 检查失败尝试是否在窗口期内
    const windowStart = new Date(now.getTime() - LOCKOUT_CONFIG.FAILED_ATTEMPT_WINDOW_MS);
    const failedAttempts =
      user.lastFailedLoginAt && user.lastFailedLoginAt > windowStart ? user.failedLoginAttempts : 0;

    const remainingAttempts = Math.max(0, LOCKOUT_CONFIG.MAX_FAILED_ATTEMPTS - failedAttempts);

    return {
      locked: false,
      remainingAttempts,
    };
  } catch (error) {
    console.error('[AccountLockout] 检查锁定状态失败:', error);
    // 发生错误时默认允许尝试（避免误锁）
    return {
      locked: false,
      remainingAttempts: LOCKOUT_CONFIG.MAX_FAILED_ATTEMPTS,
    };
  }
}

/**
 * 记录登录失败尝试
 *
 * @param email 用户邮箱
 * @returns 失败记录结果
 */
export async function recordFailedAttempt(email: string): Promise<FailedAttemptResult> {
  const normalizedEmail = email.toLowerCase().trim();
  const now = new Date();

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        failedLoginAttempts: true,
        lastFailedLoginAt: true,
        lockoutCount: true,
      },
    });

    if (!user) {
      // 用户不存在时返回正常状态（避免用户枚举）
      return {
        nowLocked: false,
        remainingAttempts: LOCKOUT_CONFIG.MAX_FAILED_ATTEMPTS - 1,
      };
    }

    // 检查是否需要重置计数（超出窗口期）
    const windowStart = new Date(now.getTime() - LOCKOUT_CONFIG.FAILED_ATTEMPT_WINDOW_MS);
    const shouldResetCount = !user.lastFailedLoginAt || user.lastFailedLoginAt < windowStart;

    const newFailedAttempts = shouldResetCount ? 1 : user.failedLoginAttempts + 1;

    // 检查是否达到锁定阈值
    if (newFailedAttempts >= LOCKOUT_CONFIG.MAX_FAILED_ATTEMPTS) {
      // 计算锁定时长（渐进式增加）
      const lockoutCount = user.lockoutCount || 0;
      const lockoutDuration = Math.min(
        LOCKOUT_CONFIG.BASE_LOCKOUT_DURATION_MS * Math.pow(LOCKOUT_CONFIG.LOCKOUT_MULTIPLIER, lockoutCount),
        LOCKOUT_CONFIG.MAX_LOCKOUT_DURATION_MS
      );
      const lockedUntil = new Date(now.getTime() + lockoutDuration);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newFailedAttempts,
          lastFailedLoginAt: now,
          lockedUntil,
          lockoutCount: lockoutCount + 1,
        },
      });

      return {
        nowLocked: true,
        remainingAttempts: 0,
        lockedUntil,
        lockoutDurationSeconds: Math.ceil(lockoutDuration / 1000),
      };
    }

    // 更新失败计数
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: newFailedAttempts,
        lastFailedLoginAt: now,
      },
    });

    return {
      nowLocked: false,
      remainingAttempts: LOCKOUT_CONFIG.MAX_FAILED_ATTEMPTS - newFailedAttempts,
    };
  } catch (error) {
    console.error('[AccountLockout] 记录失败尝试失败:', error);
    return {
      nowLocked: false,
      remainingAttempts: LOCKOUT_CONFIG.MAX_FAILED_ATTEMPTS - 1,
    };
  }
}

/**
 * 重置登录失败计数（登录成功后调用）
 *
 * @param email 用户邮箱
 */
export async function resetFailedAttempts(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  try {
    await prisma.user.update({
      where: { email: normalizedEmail },
      data: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        // 注意：不重置 lockoutCount，保留历史记录
      },
    });
  } catch (error) {
    // 用户可能不存在，忽略错误
    console.warn('[AccountLockout] 重置失败计数失败（可能用户不存在）:', error);
  }
}

/**
 * 管理员解锁账户
 *
 * @param email 用户邮箱
 */
export async function unlockAccount(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

  try {
    await prisma.user.update({
      where: { email: normalizedEmail },
      data: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        lockoutCount: 0,
      },
    });
    return true;
  } catch {
    return false;
  }
}

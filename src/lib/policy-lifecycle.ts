// src/lib/policy-lifecycle.ts
// 策略生命周期管理：软删除、恢复、定时清理

import { prisma } from '@/lib/prisma';
import { Policy } from '@prisma/client';

// 回收站保留天数
const RECYCLE_BIN_RETENTION_DAYS = 30;

export interface SoftDeleteResult {
  success: boolean;
  policyId: string;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  policyId: string;
  error?: string;
  nameConflict?: boolean;
  newName?: string;
}

export interface TrashItem {
  id: string;
  policyId: string;
  name: string;
  description: string | null;
  deletedAt: Date;
  deletedBy: string;
  expiresAt: Date;
  daysRemaining: number;
}

/**
 * 软删除策略
 * 1. 设置 deletedAt, deletedBy, deleteReason 字段
 * 2. 创建 PolicyRecycleBin 快照记录
 */
export async function softDeletePolicy(
  policyId: string,
  userId: string,
  reason?: string
): Promise<SoftDeleteResult> {
  try {
    // 检查策略是否存在且属于该用户
    const policy = await prisma.policy.findFirst({
      where: {
        id: policyId,
        userId,
        deletedAt: null, // 未被删除的策略
      },
    });

    if (!policy) {
      return {
        success: false,
        policyId,
        error: 'Policy not found or already deleted',
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + RECYCLE_BIN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // 创建快照和标记删除（事务）
    await prisma.$transaction([
      // 创建回收站快照
      prisma.policyRecycleBin.create({
        data: {
          policyId,
          userId,
          snapshot: {
            id: policy.id,
            name: policy.name,
            description: policy.description,
            content: policy.content,
            version: policy.version,
            isPublic: policy.isPublic,
            shareSlug: policy.shareSlug,
            piiFields: policy.piiFields,
            teamId: policy.teamId,
            createdAt: policy.createdAt.toISOString(),
            updatedAt: policy.updatedAt.toISOString(),
          },
          deletedBy: userId,
          expiresAt,
        },
      }),
      // 标记策略为已删除
      prisma.policy.update({
        where: { id: policyId },
        data: {
          deletedAt: now,
          deletedBy: userId,
          deleteReason: reason || null,
        },
      }),
    ]);

    return { success: true, policyId };
  } catch (error) {
    console.error('Soft delete policy error:', error);
    return {
      success: false,
      policyId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 恢复已删除的策略
 * 1. 检查策略是否在回收站中
 * 2. 检查名称冲突，如有冲突则添加后缀
 * 3. 清除软删除标记
 * 4. 删除回收站记录
 */
export async function restorePolicy(policyId: string, userId: string): Promise<RestoreResult> {
  try {
    // 检查策略是否在回收站中
    const policy = await prisma.policy.findFirst({
      where: {
        id: policyId,
        userId,
        deletedAt: { not: null }, // 已被删除的策略
      },
      include: {
        recycleBin: true,
      },
    });

    if (!policy || !policy.recycleBin) {
      return {
        success: false,
        policyId,
        error: 'Policy not found in trash',
      };
    }

    // 检查名称冲突（与现有未删除策略）
    const existingPolicy = await prisma.policy.findFirst({
      where: {
        userId,
        name: policy.name,
        deletedAt: null,
        id: { not: policyId },
      },
    });

    let newName = policy.name;
    let nameConflict = false;

    if (existingPolicy) {
      // 名称冲突，添加后缀
      nameConflict = true;
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      newName = `${policy.name} (Restored ${timestamp})`;
    }

    // 恢复策略（事务）
    await prisma.$transaction([
      // 清除软删除标记并更新名称（如有冲突）
      prisma.policy.update({
        where: { id: policyId },
        data: {
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
          name: newName,
        },
      }),
      // 删除回收站记录
      prisma.policyRecycleBin.delete({
        where: { policyId },
      }),
    ]);

    return {
      success: true,
      policyId,
      nameConflict,
      newName: nameConflict ? newName : undefined,
    };
  } catch (error) {
    console.error('Restore policy error:', error);
    return {
      success: false,
      policyId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 永久删除策略（从回收站彻底删除）
 */
export async function permanentDeletePolicy(
  policyId: string,
  userId: string
): Promise<SoftDeleteResult> {
  try {
    // 检查策略是否在回收站中
    const policy = await prisma.policy.findFirst({
      where: {
        id: policyId,
        userId,
        deletedAt: { not: null },
      },
    });

    if (!policy) {
      return {
        success: false,
        policyId,
        error: 'Policy not found in trash',
      };
    }

    // 永久删除（级联删除会清理关联记录）
    await prisma.policy.delete({
      where: { id: policyId },
    });

    return { success: true, policyId };
  } catch (error) {
    console.error('Permanent delete policy error:', error);
    return {
      success: false,
      policyId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 获取用户的回收站列表
 */
export async function getTrashItems(userId: string): Promise<TrashItem[]> {
  const recycleBinItems = await prisma.policyRecycleBin.findMany({
    where: { userId },
    orderBy: { deletedAt: 'desc' },
    include: {
      policy: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
    },
  });

  const now = new Date();

  return recycleBinItems.map((item) => {
    const daysRemaining = Math.max(
      0,
      Math.ceil((item.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );

    return {
      id: item.id,
      policyId: item.policyId,
      name: item.policy.name,
      description: item.policy.description,
      deletedAt: item.deletedAt,
      deletedBy: item.deletedBy,
      expiresAt: item.expiresAt,
      daysRemaining,
    };
  });
}

/**
 * 清理过期的回收站项目
 * 应由定时任务调用（如 Vercel Cron）
 */
export async function cleanupExpiredTrashItems(): Promise<{
  deletedCount: number;
  errors: string[];
}> {
  const now = new Date();
  const errors: string[] = [];
  let deletedCount = 0;

  try {
    // 查找所有过期的回收站项目
    const expiredItems = await prisma.policyRecycleBin.findMany({
      where: {
        expiresAt: { lte: now },
      },
      select: { policyId: true },
    });

    // 永久删除过期策略
    for (const item of expiredItems) {
      try {
        await prisma.policy.delete({
          where: { id: item.policyId },
        });
        deletedCount++;
      } catch (err) {
        errors.push(`Failed to delete policy ${item.policyId}: ${err}`);
      }
    }
  } catch (error) {
    errors.push(`Cleanup error: ${error}`);
  }

  return { deletedCount, errors };
}

/**
 * 获取用户的回收站统计
 */
export async function getTrashStats(userId: string): Promise<{
  count: number;
  oldestExpiresAt: Date | null;
  newestDeletedAt: Date | null;
}> {
  const [count, oldest, newest] = await Promise.all([
    prisma.policyRecycleBin.count({ where: { userId } }),
    prisma.policyRecycleBin.findFirst({
      where: { userId },
      orderBy: { expiresAt: 'asc' },
      select: { expiresAt: true },
    }),
    prisma.policyRecycleBin.findFirst({
      where: { userId },
      orderBy: { deletedAt: 'desc' },
      select: { deletedAt: true },
    }),
  ]);

  return {
    count,
    oldestExpiresAt: oldest?.expiresAt || null,
    newestDeletedAt: newest?.deletedAt || null,
  };
}

/**
 * 批量清空回收站
 */
export async function emptyTrash(userId: string): Promise<{
  deletedCount: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let deletedCount = 0;

  try {
    // 查找用户所有回收站项目
    const trashItems = await prisma.policyRecycleBin.findMany({
      where: { userId },
      select: { policyId: true },
    });

    // 永久删除所有
    for (const item of trashItems) {
      try {
        await prisma.policy.delete({
          where: { id: item.policyId },
        });
        deletedCount++;
      } catch (err) {
        errors.push(`Failed to delete policy ${item.policyId}: ${err}`);
      }
    }
  } catch (error) {
    errors.push(`Empty trash error: ${error}`);
  }

  return { deletedCount, errors };
}

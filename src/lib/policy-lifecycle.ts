// src/lib/policy-lifecycle.ts
// 策略生命周期管理：软删除、恢复、定时清理

import { db, policies, policyRecycleBins } from '@/lib/prisma';
import { eq, isNotNull, isNull, not, and, desc, asc, lte, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

type Policy = InferSelectModel<typeof policies>;

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
    const policy = await db.query.policies.findFirst({
      where: and(
        eq(policies.id, policyId),
        eq(policies.userId, userId),
        isNull(policies.deletedAt) // 未被删除的策略
      ),
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
    await db.transaction(async (tx) => {
      // 创建回收站快照
      await tx.insert(policyRecycleBins).values({
        id: crypto.randomUUID(),
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
      });

      // 标记策略为已删除
      await tx.update(policies)
        .set({
          deletedAt: now,
          deletedBy: userId,
          deleteReason: reason || null,
        })
        .where(eq(policies.id, policyId));
    });

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
    const policy = await db.query.policies.findFirst({
      where: and(
        eq(policies.id, policyId),
        eq(policies.userId, userId),
        isNotNull(policies.deletedAt) // 已被删除的策略
      ),
      with: {
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
    const existingPolicy = await db.query.policies.findFirst({
      where: and(
        eq(policies.userId, userId),
        eq(policies.name, policy.name),
        isNull(policies.deletedAt),
        not(eq(policies.id, policyId))
      ),
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
    await db.transaction(async (tx) => {
      // 清除软删除标记并更新名称（如有冲突）
      await tx.update(policies)
        .set({
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
          name: newName,
        })
        .where(eq(policies.id, policyId));

      // 删除回收站记录
      await tx.delete(policyRecycleBins)
        .where(eq(policyRecycleBins.policyId, policyId));
    });

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
    const policy = await db.query.policies.findFirst({
      where: and(
        eq(policies.id, policyId),
        eq(policies.userId, userId),
        isNotNull(policies.deletedAt)
      ),
    });

    if (!policy) {
      return {
        success: false,
        policyId,
        error: 'Policy not found in trash',
      };
    }

    // 永久删除（级联删除会清理关联记录）
    await db.delete(policies)
      .where(eq(policies.id, policyId));

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
  const recycleBinItems = await db.query.policyRecycleBins.findMany({
    where: eq(policyRecycleBins.userId, userId),
    orderBy: [desc(policyRecycleBins.deletedAt)],
    with: {
      policy: {
        columns: {
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
    const expiredItems = await db.query.policyRecycleBins.findMany({
      where: lte(policyRecycleBins.expiresAt, now),
      columns: { policyId: true },
    });

    // 永久删除过期策略
    for (const item of expiredItems) {
      try {
        await db.delete(policies)
          .where(eq(policies.id, item.policyId));
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
  const [countResult, oldest, newest] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` })
      .from(policyRecycleBins)
      .where(eq(policyRecycleBins.userId, userId)),
    db.query.policyRecycleBins.findFirst({
      where: eq(policyRecycleBins.userId, userId),
      orderBy: [asc(policyRecycleBins.expiresAt)],
      columns: { expiresAt: true },
    }),
    db.query.policyRecycleBins.findFirst({
      where: eq(policyRecycleBins.userId, userId),
      orderBy: [desc(policyRecycleBins.deletedAt)],
      columns: { deletedAt: true },
    }),
  ]);

  const count = countResult[0]?.count || 0;

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
    const trashItems = await db.query.policyRecycleBins.findMany({
      where: eq(policyRecycleBins.userId, userId),
      columns: { policyId: true },
    });

    // 永久删除所有
    for (const item of trashItems) {
      try {
        await db.delete(policies)
          .where(eq(policies.id, item.policyId));
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

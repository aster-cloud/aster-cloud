/**
 * 策略版本管理服务
 *
 * 支持多版本共存：
 * - DRAFT: 草稿，编辑中
 * - PENDING_APPROVAL: 待审批
 * - APPROVED: 已批准，可执行
 * - REJECTED: 已拒绝
 * - DEPRECATED: 已废弃，仍可执行但有警告
 * - ARCHIVED: 已归档，不可执行
 */

import { prisma } from '@/lib/prisma';
import type { PolicyVersionStatus } from '@prisma/client';
import { computeChainedHash, computeSourceHash } from '../security/policy-security';
import { logSecurityEvent } from '../security/security-event-service';

export interface CreateVersionParams {
  policyId: string;
  source: string;
  createdBy: string;
  releaseNote?: string;
}

export interface CreateVersionResult {
  id: string;
  version: number;
  sourceHash: string;
}

/**
 * 创建新版本
 *
 * 自动计算链式哈希，确保版本历史完整性。
 */
export async function createVersion(
  params: CreateVersionParams
): Promise<CreateVersionResult> {
  const { policyId, source, createdBy, releaseNote } = params;

  // 获取最新版本号和哈希
  const latestVersion = await prisma.policyVersion.findFirst({
    where: { policyId },
    orderBy: { version: 'desc' },
    select: { version: true, sourceHash: true },
  });

  const newVersionNumber = (latestVersion?.version ?? 0) + 1;
  const prevHash = latestVersion?.sourceHash ?? null;
  const sourceHash = computeChainedHash(source, prevHash);

  const created = await prisma.policyVersion.create({
    data: {
      policyId,
      version: newVersionNumber,
      source,
      content: source, // 兼容旧字段
      sourceHash,
      prevHash,
      createdBy,
      releaseNote,
      status: 'DRAFT' as PolicyVersionStatus,
    },
  });

  await logSecurityEvent({
    eventType: 'VERSION_CREATED',
    severity: 'INFO',
    policyId,
    userId: createdBy,
    details: { version: newVersionNumber, sourceHash },
  });

  return {
    id: created.id,
    version: newVersionNumber,
    sourceHash,
  };
}

/**
 * 更新版本源码（仅限草稿状态）
 */
export async function updateVersionSource(params: {
  policyId: string;
  version: number;
  source: string;
  userId: string;
}): Promise<{ sourceHash: string }> {
  const { policyId, version, source, userId } = params;

  const targetVersion = await prisma.policyVersion.findFirst({
    where: {
      policyId,
      version,
      status: 'DRAFT' as PolicyVersionStatus,
    },
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或不是草稿状态，无法编辑`);
  }

  // 重新计算链式哈希
  const prevHash = targetVersion.prevHash;
  const sourceHash = computeChainedHash(source, prevHash);

  await prisma.policyVersion.update({
    where: { id: targetVersion.id },
    data: {
      source,
      content: source, // 兼容旧字段
      sourceHash,
    },
  });

  return { sourceHash };
}

/**
 * 提交版本审批
 */
export async function submitForApproval(params: {
  policyId: string;
  version: number;
  userId: string;
}): Promise<void> {
  const { policyId, version, userId } = params;

  const targetVersion = await prisma.policyVersion.findFirst({
    where: {
      policyId,
      version,
      status: { in: ['DRAFT', 'REJECTED'] as PolicyVersionStatus[] },
    },
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或状态不允许提交审批`);
  }

  await prisma.policyVersion.update({
    where: { id: targetVersion.id },
    data: { status: 'PENDING_APPROVAL' as PolicyVersionStatus },
  });

  await logSecurityEvent({
    eventType: 'APPROVAL_DECISION',
    severity: 'INFO',
    policyId,
    userId,
    details: { version, action: 'SUBMIT_FOR_APPROVAL' },
  });
}

/**
 * 审批版本
 */
export async function approveVersion(params: {
  policyId: string;
  version: number;
  approverId: string;
  decision: 'APPROVED' | 'REJECTED' | 'REQUESTED_CHANGES';
  comment?: string;
}): Promise<void> {
  const { policyId, version, approverId, decision, comment } = params;

  const targetVersion = await prisma.policyVersion.findFirst({
    where: {
      policyId,
      version,
      status: 'PENDING_APPROVAL' as PolicyVersionStatus,
    },
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或不在待审批状态`);
  }

  // 四眼原则：创建者不能审批自己的版本
  if (targetVersion.createdBy === approverId) {
    await logSecurityEvent({
      eventType: 'SELF_APPROVAL_ATTEMPT',
      severity: 'WARNING',
      policyId,
      userId: approverId,
      details: { version },
    });
    throw new Error('不能审批自己创建的版本（四眼原则）');
  }

  // 创建审批记录
  await prisma.policyApproval.create({
    data: {
      versionId: targetVersion.id,
      approverId,
      decision,
      comment,
    },
  });

  // 更新版本状态
  let newStatus: PolicyVersionStatus;
  switch (decision) {
    case 'APPROVED':
      newStatus = 'APPROVED';
      break;
    case 'REJECTED':
      newStatus = 'REJECTED';
      break;
    case 'REQUESTED_CHANGES':
      newStatus = 'DRAFT'; // 退回修改
      break;
  }

  await prisma.policyVersion.update({
    where: { id: targetVersion.id },
    data: { status: newStatus },
  });

  await logSecurityEvent({
    eventType: 'APPROVAL_DECISION',
    severity: 'INFO',
    policyId,
    userId: approverId,
    details: { version, decision, comment },
  });
}

/**
 * 设置默认执行版本（原子操作）
 */
export async function setDefaultVersion(params: {
  policyId: string;
  version: number;
  userId: string;
}): Promise<void> {
  const { policyId, version, userId } = params;

  // 验证目标版本存在且已批准
  const targetVersion = await prisma.policyVersion.findFirst({
    where: {
      policyId,
      version,
      status: 'APPROVED' as PolicyVersionStatus,
    },
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或未批准，无法设为默认`);
  }

  // 原子操作：清除旧默认 + 设置新默认
  await prisma.$transaction([
    prisma.policyVersion.updateMany({
      where: { policyId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.policyVersion.update({
      where: { id: targetVersion.id },
      data: { isDefault: true },
    }),
  ]);

  await logSecurityEvent({
    eventType: 'VERSION_SET_DEFAULT',
    severity: 'INFO',
    policyId,
    userId,
    details: { version },
  });
}

/**
 * 废弃版本（仍可执行，但有警告）
 */
export async function deprecateVersion(params: {
  policyId: string;
  version: number;
  userId: string;
  reason?: string;
}): Promise<void> {
  const { policyId, version, userId, reason } = params;

  const targetVersion = await prisma.policyVersion.findFirst({
    where: {
      policyId,
      version,
      status: 'APPROVED' as PolicyVersionStatus,
    },
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或未批准，无法废弃`);
  }

  // 如果是默认版本，不允许废弃
  if (targetVersion.isDefault) {
    throw new Error(`版本 v${version} 是默认版本，请先设置其他版本为默认`);
  }

  await prisma.policyVersion.update({
    where: { id: targetVersion.id },
    data: {
      status: 'DEPRECATED' as PolicyVersionStatus,
      deprecatedAt: new Date(),
      deprecatedBy: userId,
    },
  });

  await logSecurityEvent({
    eventType: 'VERSION_DEPRECATED',
    severity: 'INFO',
    policyId,
    userId,
    details: { version, reason },
  });
}

/**
 * 归档版本（不可执行）
 */
export async function archiveVersion(params: {
  policyId: string;
  version: number;
  userId: string;
  reason?: string;
}): Promise<void> {
  const { policyId, version, userId, reason } = params;

  const targetVersion = await prisma.policyVersion.findFirst({
    where: {
      policyId,
      version,
      status: { in: ['APPROVED', 'DEPRECATED'] as PolicyVersionStatus[] },
    },
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或状态不允许归档`);
  }

  // 如果是默认版本，不允许归档
  if (targetVersion.isDefault) {
    throw new Error(`版本 v${version} 是默认版本，请先设置其他版本为默认`);
  }

  await prisma.policyVersion.update({
    where: { id: targetVersion.id },
    data: {
      status: 'ARCHIVED' as PolicyVersionStatus,
      archivedAt: new Date(),
      archivedBy: userId,
    },
  });

  await logSecurityEvent({
    eventType: 'VERSION_ARCHIVED',
    severity: 'INFO',
    policyId,
    userId,
    details: { version, reason },
  });
}

/**
 * 获取策略的所有版本
 */
export async function listVersions(policyId: string) {
  return prisma.policyVersion.findMany({
    where: { policyId },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      sourceHash: true,
      status: true,
      isDefault: true,
      releaseNote: true,
      createdBy: true,
      createdAt: true,
      deprecatedAt: true,
      deprecatedBy: true,
      archivedAt: true,
      archivedBy: true,
      _count: { select: { approvals: true } },
    },
  });
}

/**
 * 获取可执行版本列表
 */
export async function listExecutableVersions(policyId: string) {
  return prisma.policyVersion.findMany({
    where: {
      policyId,
      status: { in: ['APPROVED', 'DEPRECATED'] as PolicyVersionStatus[] },
    },
    orderBy: { version: 'desc' },
    select: {
      version: true,
      sourceHash: true,
      status: true,
      isDefault: true,
      releaseNote: true,
      deprecatedAt: true,
    },
  });
}

/**
 * 获取特定版本详情
 */
export async function getVersionDetail(params: {
  policyId: string;
  version: number;
}) {
  const { policyId, version } = params;

  return prisma.policyVersion.findFirst({
    where: { policyId, version },
    include: {
      approvals: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

/**
 * 获取版本的源码
 */
export async function getVersionSource(params: {
  policyId: string;
  version: number;
}): Promise<{ source: string; sourceHash: string } | null> {
  const { policyId, version } = params;

  const result = await prisma.policyVersion.findFirst({
    where: { policyId, version },
    select: {
      source: true,
      content: true, // 兼容旧字段
      sourceHash: true,
    },
  });

  if (!result) {
    return null;
  }

  return {
    source: result.source ?? result.content,
    sourceHash: result.sourceHash ?? computeSourceHash(result.source ?? result.content),
  };
}

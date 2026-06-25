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

import { db, policyVersions, policyApprovals } from '@/lib/prisma';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import { computeChainedHash, computeSourceHash } from '../security/policy-security';
import { logSecurityEvent } from '../security/security-event-service';
import { recordAhaMomentIfFirst } from '@/lib/metrics/aha-detection';
import { snapshotOnPolicyApprove } from '@/lib/domain-vocabulary-snapshot';
import {
  canonicalAliasJson,
  computeSourceEnvelope,
  validateUserAliases,
  USER_ALIAS_VALIDATOR_VERSION,
  type ReservedSets,
} from '@/lib/policy-alias';

type PolicyVersion = InferSelectModel<typeof policyVersions>;
type PolicyVersionStatus = PolicyVersion['status'];

export interface CreateVersionParams {
  policyId: string;
  source: string;
  createdBy: string;
  releaseNote?: string;
  /** 编译 locale（进 source envelope）。缺省 'en-US'。 */
  locale?: string;
  /**
   * 用户自定义关键词别名（ADR 0022 方案 D），kind→[别名,...]。缺省=无别名。
   * 提供时经 validate → canonicalJson 冻结，并算 source envelope 一并落库。
   */
  aliasSet?: Readonly<Record<string, readonly string[]>> | null;
  /** 别名校验占用集（规范拼写/base别名/领域词汇）。提供 aliasSet 时应一并提供。 */
  aliasReserved?: ReservedSets;
  /** 工具链身份串（进 envelope）。缺省由 env ASTER_RUNTIME_BUILD 拼。 */
  toolchainId?: string;
}

export interface CreateVersionResult {
  id: string;
  version: number;
  sourceHash: string;
  sourceEnvelopeSha256: string;
}

/** 工具链身份（与 Java toolchainIdentity 同格式；core/abi 由 ts 引擎版本，build 由 env）。 */
function defaultToolchainId(): string {
  const build = process.env.ASTER_RUNTIME_BUILD ?? 'dev';
  return `abi=1.0;core=ts;validator=${USER_ALIAS_VALIDATOR_VERSION};build=${build}`;
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
  const locale = params.locale ?? 'en-US';

  // ADR 0022 方案 D：校验 + 冻结别名 + 算 source envelope（防替换篡改）。
  let aliasSetJson: string | null = null;
  if (params.aliasSet && Object.keys(params.aliasSet).length > 0) {
    // fail-closed（Codex 复核）：有别名但没给占用集 → 拒绝。空 reserved 会跳过遮蔽/领域词
    // 碰撞校验（退回 H3/遮蔽风险）。调用方必须从 ts 引擎 lexicon 构造完整 ReservedSets。
    if (!params.aliasReserved) {
      throw new Error(
        'aliasSet 非空但未提供 aliasReserved（规范拼写/base别名/领域词汇占用集）——拒绝创建，' +
          '防跳过遮蔽/碰撞校验',
      );
    }
    const vr = validateUserAliases(params.aliasSet, params.aliasReserved);
    if (!vr.valid) {
      throw new Error(`用户自定义别名校验失败: ${vr.errors.join('; ')}`);
    }
    aliasSetJson = canonicalAliasJson(params.aliasSet);
  }
  const toolchainId = params.toolchainId ?? defaultToolchainId();
  const sourceEnvelopeSha256 = computeSourceEnvelope(source, aliasSetJson, locale, toolchainId);

  // 获取最新版本号和链接哈希。
  // 链接 = envelope（存在时）否则 sourceHash —— 与 Java chainLink 对齐（ADR 0022 §11.5 C1-a）：
  // 让 alias_set 篡改对版本链可见（前序版本带别名时其 envelope 进链，改 alias_set 即断链）。
  const latestVersion = await db.query.policyVersions.findFirst({
    where: eq(policyVersions.policyId, policyId),
    orderBy: [desc(policyVersions.version)],
    columns: { version: true, sourceHash: true, sourceEnvelopeSha256: true },
  });

  const newVersionNumber = (latestVersion?.version ?? 0) + 1;
  const prevHash = latestVersion
    ? (latestVersion.sourceEnvelopeSha256 ?? latestVersion.sourceHash)
    : null;
  const sourceHash = computeChainedHash(source, prevHash);

  const [created] = await db.insert(policyVersions).values({
    id: crypto.randomUUID(),
    policyId,
    version: newVersionNumber,
    source,
    content: source, // 兼容旧字段
    sourceHash,
    prevHash,
    createdBy,
    releaseNote,
    status: 'DRAFT',
    aliasSet: aliasSetJson,
    sourceEnvelopeSha256,
    sourceToolchainId: toolchainId,
  }).returning();

  await logSecurityEvent({
    eventType: 'VERSION_CREATED',
    severity: 'INFO',
    policyId,
    userId: createdBy,
    details: { version: newVersionNumber, sourceHash, hasAliases: aliasSetJson != null },
  });

  return {
    id: created.id,
    version: newVersionNumber,
    sourceHash,
    sourceEnvelopeSha256,
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
  const { policyId, version, source, userId: _userId } = params;

  const targetVersion = await db.query.policyVersions.findFirst({
    where: and(
      eq(policyVersions.policyId, policyId),
      eq(policyVersions.version, version),
      eq(policyVersions.status, 'DRAFT')
    ),
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或不是草稿状态，无法编辑`);
  }

  // 重新计算链式哈希
  const prevHash = targetVersion.prevHash;
  const sourceHash = computeChainedHash(source, prevHash);

  await db.update(policyVersions)
    .set({
      source,
      content: source, // 兼容旧字段
      sourceHash,
    })
    .where(eq(policyVersions.id, targetVersion.id));

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

  const targetVersion = await db.query.policyVersions.findFirst({
    where: and(
      eq(policyVersions.policyId, policyId),
      eq(policyVersions.version, version),
      inArray(policyVersions.status, ['DRAFT', 'REJECTED'])
    ),
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或状态不允许提交审批`);
  }

  await db.update(policyVersions)
    .set({ status: 'PENDING_APPROVAL' })
    .where(eq(policyVersions.id, targetVersion.id));

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

  const targetVersion = await db.query.policyVersions.findFirst({
    where: and(
      eq(policyVersions.policyId, policyId),
      eq(policyVersions.version, version),
      eq(policyVersions.status, 'PENDING_APPROVAL')
    ),
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
  await db.insert(policyApprovals).values({
    id: crypto.randomUUID(),
    versionId: targetVersion.id,
    approverId,
    decision,
    comment,
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

  await db.update(policyVersions)
    .set({ status: newStatus })
    .where(eq(policyVersions.id, targetVersion.id));

  await logSecurityEvent({
    eventType: 'APPROVAL_DECISION',
    severity: 'INFO',
    policyId,
    userId: approverId,
    details: { version, decision, comment },
  });

  // PM 02 north-star: detect AHA moment (author's first approved version).
  // Fire-and-forget — failure must NOT break the approval flow.
  if (decision === 'APPROVED' && targetVersion.createdBy) {
    recordAhaMomentIfFirst({
      userId: targetVersion.createdBy,
      policyVersionId: targetVersion.id,
      approvedAt: new Date(),
    }).catch((err) => {
      console.error('[AHA detection] failed (non-blocking):', err);
    });

    // B12 — Snapshot the author's active vocabulary so future rollbacks can
    // restore the exact term set this version was compiled against. The
    // helper is itself best-effort; never block approval on snapshot IO.
    snapshotOnPolicyApprove({
      policyVersionId: targetVersion.id,
      policyAuthorId: targetVersion.createdBy,
    }).catch((err) => {
      console.error('[vocabulary-snapshot] failed (non-blocking):', err);
    });
  }
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
  const targetVersion = await db.query.policyVersions.findFirst({
    where: and(
      eq(policyVersions.policyId, policyId),
      eq(policyVersions.version, version),
      eq(policyVersions.status, 'APPROVED')
    ),
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或未批准，无法设为默认`);
  }

  // 原子操作：清除旧默认 + 设置新默认
  await db.transaction(async (tx) => {
    await tx.update(policyVersions)
      .set({ isDefault: false })
      .where(and(
        eq(policyVersions.policyId, policyId),
        eq(policyVersions.isDefault, true)
      ));

    await tx.update(policyVersions)
      .set({ isDefault: true })
      .where(eq(policyVersions.id, targetVersion.id));
  });

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

  const targetVersion = await db.query.policyVersions.findFirst({
    where: and(
      eq(policyVersions.policyId, policyId),
      eq(policyVersions.version, version),
      eq(policyVersions.status, 'APPROVED')
    ),
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或未批准，无法废弃`);
  }

  // 如果是默认版本，不允许废弃
  if (targetVersion.isDefault) {
    throw new Error(`版本 v${version} 是默认版本，请先设置其他版本为默认`);
  }

  await db.update(policyVersions)
    .set({
      status: 'DEPRECATED',
      deprecatedAt: new Date(),
      deprecatedBy: userId,
    })
    .where(eq(policyVersions.id, targetVersion.id));

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

  const targetVersion = await db.query.policyVersions.findFirst({
    where: and(
      eq(policyVersions.policyId, policyId),
      eq(policyVersions.version, version),
      inArray(policyVersions.status, ['APPROVED', 'DEPRECATED'])
    ),
  });

  if (!targetVersion) {
    throw new Error(`版本 v${version} 不存在或状态不允许归档`);
  }

  // 如果是默认版本，不允许归档
  if (targetVersion.isDefault) {
    throw new Error(`版本 v${version} 是默认版本，请先设置其他版本为默认`);
  }

  await db.update(policyVersions)
    .set({
      status: 'ARCHIVED',
      archivedAt: new Date(),
      archivedBy: userId,
    })
    .where(eq(policyVersions.id, targetVersion.id));

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
  const versions = await db.query.policyVersions.findMany({
    where: eq(policyVersions.policyId, policyId),
    orderBy: [desc(policyVersions.version)],
    columns: {
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
    },
  });

  // 获取每个版本的审批数量
  const versionsWithCount = await Promise.all(
    versions.map(async (v) => {
      const approvalCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(policyApprovals)
        .where(eq(policyApprovals.versionId, v.id));

      return {
        ...v,
        _count: { approvals: approvalCount[0]?.count || 0 },
      };
    })
  );

  return versionsWithCount;
}

/**
 * 获取可执行版本列表
 */
export async function listExecutableVersions(policyId: string) {
  return db.query.policyVersions.findMany({
    where: and(
      eq(policyVersions.policyId, policyId),
      inArray(policyVersions.status, ['APPROVED', 'DEPRECATED'])
    ),
    orderBy: [desc(policyVersions.version)],
    columns: {
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

  return db.query.policyVersions.findFirst({
    where: and(
      eq(policyVersions.policyId, policyId),
      eq(policyVersions.version, version)
    ),
    with: {
      approvals: {
        orderBy: [desc(policyApprovals.createdAt)],
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

  const result = await db.query.policyVersions.findFirst({
    where: and(
      eq(policyVersions.policyId, policyId),
      eq(policyVersions.version, version)
    ),
    columns: {
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
